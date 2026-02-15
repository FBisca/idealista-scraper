import * as cheerio from 'cheerio'
import { log } from '@workspace/logger'

export class CaptchaDectector {
  async detect(_url: string, html: string): Promise<string | undefined> {
    const $ = cheerio.load(html)
    try {
      // Check for actual CAPTCHA challenges that block content, not invisible badges/widgets
      // Get page text once for all checks
      const pageText = $('body').text().toLowerCase()

      // 1. Cloudflare challenge pages (these block content)
      const hasCloudflareChallenge =
        $('#cf-challenge-running').length > 0 ||
        $('.cf-browser-verification').length > 0 ||
        $('script[src*="/cdn-cgi/challenge-platform/"]').length > 0 ||
        $('script[src*="challenges.cloudflare.com/turnstile"]').length > 0 ||
        ($('title:contains("Just a moment")').length > 0 && $('.ray-id').length > 0) ||
        ($('body').text().includes('Verify you are human') && $('.ray-id code').length > 0)

      if (hasCloudflareChallenge) {
        log.debug('[CaptchaDetector] Cloudflare challenge detected')
        if (pageText.length > 10000) {
          log.warn('[CaptchaDetector] Cloudflare challenge detected but page text seems to be visible, ignoring')
          return undefined
        }
        return 'cloudflare-challenge'
      }

      // 2. DuckDuckGo challenge page (specific modal/challenge form)
      const ddgChallengeModal = $('.anomaly-modal__modal, .anomaly-modal__puzzle, [data-testid="anomaly-modal"]')
      if (ddgChallengeModal.length > 0) {
        // Check if it's actually a challenge, not just a regular modal
        const hasChallengeText =
          $.text().includes('bots use DuckDuckGo') ||
          $.text().includes('select all squares') ||
          $('.anomaly-modal__puzzle').length > 0
        if (hasChallengeText) {
          log.debug('[CaptchaDetector] DuckDuckGo challenge detected')
          return 'duckduckgo-challenge'
        }
      }

      // 3. reCAPTCHA detection (must distinguish between badge and actual challenge)
      // - Badge: iframe[src*="recaptcha/api2/anchor"] - invisible badge, NOT blocking
      // - Challenge: iframe[src*="recaptcha/api2/bframe"] - actual challenge, IS blocking
      const recaptchaChallengeIframe = $('iframe[src*="recaptcha/api2/bframe"]')
      const recaptchaBadgeIframe = $('iframe[src*="recaptcha/api2/anchor"]')

      // If there's a challenge iframe (bframe), it's definitely a blocking CAPTCHA
      if (recaptchaChallengeIframe.length > 0) {
        log.debug('[CaptchaDetector] reCAPTCHA challenge iframe (bframe) detected')
        if (pageText.length > 10000) {
          log.warn(
            '[CaptchaDetector] reCAPTCHA challenge iframe (bframe) detected but page text seems to be visible, ignoring'
          )
          return undefined
        }
        return 'recaptcha-challenge-bframe'
      }

      // If there's ONLY a badge iframe (anchor) and no challenge indicators, ignore it
      // Badges are invisible widgets that don't block content - they're just present on the page
      if (recaptchaBadgeIframe.length > 0) {
        // Check if page has challenge indicators (text suggesting blocking CAPTCHA)
        const hasChallengeIndicators =
          pageText.includes('verify you') ||
          pageText.includes('not a robot') ||
          pageText.includes('select all images') ||
          pageText.includes('complete the verification')

        // If no challenge indicators, it's just a badge, not a blocking CAPTCHA
        if (!hasChallengeIndicators) {
          // Just a badge (invisible widget), not blocking - ignore
          log.debug('[CaptchaDetector] reCAPTCHA badge detected (not blocking) - ignoring')
          return undefined
        }
      }

      // 4. Check for other blocking CAPTCHA indicators (reCAPTCHA forms with challenge text)
      const isChallengePage =
        pageText.includes('verify you') ||
        pageText.includes('not a robot') ||
        pageText.includes('select all images') ||
        pageText.includes('select all squares') ||
        (pageText.includes('challenge') && pageText.includes('complete'))

      // reCAPTCHA forms with challenge indicators (but not just badges)
      const recaptchaElements = $('.g-recaptcha, .recaptcha-challenge, #recaptcha')
      if (recaptchaElements.length > 0 && isChallengePage && recaptchaBadgeIframe.length === 0) {
        log.debug('[CaptchaDetector] reCAPTCHA challenge form detected (with challenge indicators)')
        return 'recaptcha-challenge'
      }

      // 5. hCaptcha challenge (check for challenge iframe, not just widget)
      const hcaptchaChallenge = $('.h-captcha, iframe[src*="hcaptcha.com/challenges"]')
      if (hcaptchaChallenge.length > 0 && isChallengePage) {
        log.debug('[CaptchaDetector] hCaptcha challenge detected')
        return 'hcaptcha-challenge'
      }

      // 6. Generic CAPTCHA forms that are blocking (avoid false positives)
      const captchaForms = $('form[id*="captcha"], form[class*="captcha"], form[id*="challenge"]')
      if (captchaForms.length > 0 && isChallengePage) {
        // Make sure it has interactive elements and challenge text
        const hasInputs = captchaForms.find('input, textarea, button').length > 0
        if (hasInputs) {
          log.debug('[CaptchaDetector] Generic CAPTCHA challenge form detected')
          return 'generic-captcha-form'
        }
      }

      // No blocking CAPTCHA detected
      return undefined
    } catch (error) {
      log.debug(`[CaptchaDetector] Error detecting CAPTCHA: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }
}
