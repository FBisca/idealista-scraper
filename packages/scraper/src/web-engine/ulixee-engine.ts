import { log } from '@workspace/logger'
import { IUserProfile, type IHeroCreateOptions } from '@ulixee/hero'
import { Hero } from '@ulixee/hero/lib/extendables'
import { extractDomain } from '../utils/url.js'
import { UlixeeProfileManager } from './ulixee-profile-manager.js'
import { FetchContentOptions, FetchResponse, WebEngine } from './types.js'
import { CaptchaDectector } from './captcha-detector.js'

type Instance = {
  hero: Hero
  createProperties: IHeroCreateOptions
}

export class UlixeeWebEngine extends WebEngine {
  private readonly heroOptions: IHeroCreateOptions
  private readonly profileManager: UlixeeProfileManager
  private readonly captchaDetector: CaptchaDectector

  private currentInstance?: Instance
  private failOnCaptcha = false

  constructor(options?: IHeroCreateOptions, profileManager?: UlixeeProfileManager, captchaDetector?: CaptchaDectector) {
    super()
    this.profileManager = profileManager ?? new UlixeeProfileManager()
    this.captchaDetector = captchaDetector ?? new CaptchaDectector()

    // Default Hero configuration
    this.heroOptions = {
      // Viewport configuration
      viewport: {
        width: 1920,
        height: 1080
      },

      // Locale and timezone
      locale: 'en-US',
      timezoneId: 'America/New_York',

      ...options
    }
  }

  async fetchContent<T>(url: string, options: FetchContentOptions<T>, retry = 0): Promise<FetchResponse<T>> {
    const { showBrowser, htmlParser } = options ?? {
      showBrowser: false
    }

    const startTime = Date.now()
    try {
      log.info(`[Ulixee Hero] Starting scrape: ${url} in ${showBrowser ? 'browser mode' : 'headless mode'}`)

      // Extract domain and load saved user profile if it exists
      const domain = extractDomain(url)
      const savedProfile = await this.profileManager.loadProfile(domain)

      if (savedProfile) {
        log.info(`[Ulixee Hero] Reusing saved profile for domain ${domain}`)
      } else {
        log.info(`[Ulixee Hero] Creating new profile for domain ${domain}`)
      }

      // Create new Hero instance with stealth capabilities and domain-specific profile
      this.currentInstance = this.getInstance({ showBrowser, userProfile: savedProfile })
      const { hero } = this.currentInstance

      // Navigate to URL - Hero automatically waits for page load
      log.info(`[Ulixee Hero] Navigating to: ${url}`)
      await hero.goto(url, { timeoutMs: 5000 })
      log.info(`[Ulixee Hero] Navigated to: ${url}`)
      // Wait for all resources to load
      await hero.waitForPaintingStable()

      log.info(`[Ulixee Hero] Page loaded successfully`)

      // Wait for JavaScript to finish rendering (network idle + DOM stability)
      await this.waitForJavaScriptToRender(hero)

      // Extract page content
      const currentUrl = await hero.url
      const title = await hero.document.title
      const html = await hero.document.documentElement.outerHTML

      // Check if page has CAPTCHA indicators
      const captchaSelector = await this.captchaDetector.detect(currentUrl, html)
      if (captchaSelector) {
        log.warn(`[Ulixee Hero] CAPTCHA detected on page ${captchaSelector}`)

        if (this.failOnCaptcha) {
          if (!showBrowser) {
            await this.cleanup()
            return this.fetchContent(url, { ...options, showBrowser: true })
          }

          // Wait for user to solve CAPTCHA (max 2 minutes)
          log.info('[Ulixee Hero] Waiting for human to solve CAPTCHA...')
          const solved = await this.waitForCaptchaSolve(hero)

          if (!solved) {
            return {
              success: false,
              error: 'CAPTCHA not solved in time',
              errorCode: 'blocked',
              metadata: {
                duration: Date.now() - startTime,
                method: 'ulixee-hero'
              }
            }
          }

          // CAPTCHA solved - save browser state for reuse on future requests to this domain
          // Note: Hero manages cookies/storage internally via userProfile
          // Profile will be saved after successful scraping
          log.info('[Ulixee Hero] CAPTCHA solved! Browser state will be saved after scraping')
        }
      }

      // Use appropriate extractor based on content type
      const contentExtracted = await htmlParser.extract({ url: currentUrl, data: html })

      log.info(`[Ulixee Hero] Successfully extracted content from ${currentUrl}`)

      try {
        const updatedProfile = await hero.exportUserProfile()
        await this.profileManager.saveProfile(domain, updatedProfile)
        log.info(`[Ulixee Hero] Saved browser profile for domain ${domain}`)
      } catch (saveError) {
        log.warn('[Ulixee Hero] Failed to save profile after scraping:', saveError)
      }

      if (captchaSelector) {
        log.info(`[Ulixee Hero] Cleaning instance to reload profile`)
        this.cleanup()
      }

      return {
        success: true,
        title,
        content: contentExtracted,
        metadata: {
          duration: Date.now() - startTime,
          method: 'ulixee-hero',
          showBrowser,
          sessionId: await hero.sessionId,
          domain
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      log.error(`[Ulixee Hero] Scraping failed:`, error)
      if (retry < 2) {
        log.info(`[Ulixee Hero] Retrying scrape... (attempt ${retry + 1}/2)`)
        await new Promise(resolve => setTimeout(resolve, 1000))
        return this.fetchContent(url, options, retry + 1)
      }

      return {
        success: false,
        error: errorMessage,
        errorCode: 'unexpected',
        metadata: {
          duration: Date.now() - startTime,
          method: 'ulixee-hero',
          showBrowser,
          failureReason: errorMessage
        }
      }
    } finally {
      this.cleanup()
    }
  }

  async launch(url: string): Promise<Hero> {
    this.currentInstance = this.getInstance({
      showBrowser: true,
      userProfile: await this.profileManager.loadProfile(extractDomain(url))
    })

    const { hero } = this.currentInstance

    try {
      log.info(`[Ulixee Hero] Navigating to: ${url}`)
      await hero.goto(url)

      // Wait for all resources to load
      await hero.waitForPaintingStable()
    } catch (error) {
      hero.close().catch()
      throw error
    }
    return hero
  }

  /**
   * Save profile for currently active Hero instance
   * @param domainSpecific - If true, save to domain file; if false, update global profile (default)
   */
  async saveProfileForCurrentDomain(domainSpecific = false): Promise<void> {
    if (!this.currentInstance) {
      throw new Error('No active Hero instance')
    }

    const { hero } = this.currentInstance
    const url = await hero?.url
    if (!url) {
      throw new Error('No URL found for active Hero instance')
    }

    const domain = extractDomain(url)

    const profile = await hero.exportUserProfile()
    await this.profileManager.saveProfile(domain, profile, domainSpecific)
  }

  /**
   * Wait for JavaScript to finish rendering content
   * Uses a fast-path optimization: only waits if page actually needs it
   * - Quick initial check (200ms): if DOM is stable and page complete, skip wait
   * - Full wait only if: DOM is changing or page not complete
   */
  private async waitForJavaScriptToRender(hero: Hero, maxWaitMs = 5000): Promise<void> {
    const quickCheckMs = 200 // Fast initial check for static pages
    const checkInterval = 500
    const stabilityRequiredMs = 1000 // DOM must be stable for 1 second

    try {
      // Fast-path: Quick initial check for static pages
      const initialDomSize = (await hero.document.documentElement.outerHTML).length
      const initialReadyState = await hero.document.readyState

      // Wait a short time to see if DOM changes
      await new Promise(resolve => setTimeout(resolve, quickCheckMs))

      const afterCheckDomSize = (await hero.document.documentElement.outerHTML).length
      const afterCheckReadyState = await hero.document.readyState

      // Fast-path success: DOM didn't change AND page is complete
      if (
        initialDomSize === afterCheckDomSize &&
        initialReadyState === 'complete' &&
        afterCheckReadyState === 'complete'
      ) {
        return
      }

      // Page appears dynamic - do full wait
      log.debug(`[Ulixee Hero] Detected dynamic content, waiting for JavaScript to finish rendering...`)

      const startTime = Date.now()
      let lastDomSize = afterCheckDomSize
      let lastStableTime = Date.now()

      while (Date.now() - startTime < maxWaitMs) {
        try {
          // Check DOM size to detect changes
          const html = await hero.document.documentElement.outerHTML
          const currentDomSize = html.length

          // Check if DOM has changed
          if (currentDomSize !== lastDomSize) {
            lastDomSize = currentDomSize
            lastStableTime = Date.now()
            log.debug(`[Ulixee Hero] DOM changed, size: ${currentDomSize}`)
          }

          // Check if page is complete
          const readyState = await hero.document.readyState
          const isComplete = readyState === 'complete'

          // If DOM is stable and page is complete, we might be done
          const timeSinceStable = Date.now() - lastStableTime
          if (isComplete && timeSinceStable >= stabilityRequiredMs) {
            log.debug(`[Ulixee Hero] JavaScript rendering complete (DOM stable for ${timeSinceStable}ms)`)
            // Give a small additional delay to ensure any queued JS has run
            await new Promise(resolve => setTimeout(resolve, 500))
            return
          }

          // Wait before next check
          await new Promise(resolve => setTimeout(resolve, checkInterval))
        } catch (error) {
          log.debug(
            `[Ulixee Hero] Error checking render status: ${error instanceof Error ? error.message : String(error)}`
          )
          await new Promise(resolve => setTimeout(resolve, checkInterval))
        }
      }

      // If we timeout, log a debug message but continue
      const elapsed = Date.now() - startTime
      log.debug(`[Ulixee Hero] Wait for JavaScript rendering completed (timeout after ${elapsed}ms)`)
    } catch (error) {
      // If initial check fails, log and continue (don't block)
      log.debug(
        `[Ulixee Hero] Error in initial JS render check: ${error instanceof Error ? error.message : String(error)}, continuing`
      )
    }
  }

  /**
   * Wait for CAPTCHA to be solved by human
   * Checks every 2 seconds for up to 2 minutes
   */
  private async waitForCaptchaSolve(hero: Hero, maxWaitMs = 120000): Promise<boolean> {
    const startTime = Date.now()
    const checkInterval = 2000

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, checkInterval))

      const html = await hero.document.documentElement.outerHTML
      const url = await hero.url

      const stillHasCaptcha = await this.captchaDetector.detect(url, html)
      if (!stillHasCaptcha) {
        log.info('[Ulixee Hero] CAPTCHA solved!')
        return true
      }

      log.info('[Ulixee Hero] Still waiting for CAPTCHA solve...')
    }

    return false
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.currentInstance) {
      try {
        await this.currentInstance.hero.close()
        this.currentInstance = undefined
        log.info('[Ulixee Hero] Instance closed')
      } catch (error) {
        log.error('[Ulixee Hero] Error closing instance:', error)
      }
    }
  }

  private getInstance({ showBrowser, userProfile }: { showBrowser?: boolean; userProfile?: IUserProfile }): Instance {
    if (this.currentInstance) {
      this.cleanup()
    }

    const createProperties = {
      ...this.heroOptions,
      showChrome: showBrowser ?? false,
      userProfile: userProfile
    } satisfies IHeroCreateOptions

    return {
      hero: new Hero(createProperties),
      createProperties
    }
  }
}
