import { log } from '@workspace/logger'
import type { IUserProfile } from '@ulixee/hero'
import { join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

type UserProfileCookie = NonNullable<IUserProfile['cookies']>[number]

/**
 * Centralized profile manager for Ulixee Hero
 * Manages both global and domain-specific profiles
 */
export class UlixeeProfileManager {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = baseDir || process.env.ULIXEE_PROFILES_DIR || join(process.cwd(), '.ulixee-profiles')
  }

  /**
   * Load global profile if exists
   */
  async loadGlobalProfile(): Promise<IUserProfile | undefined> {
    const globalPath = this.getGlobalProfilePath()

    try {
      if (existsSync(globalPath)) {
        const profileData = await readFile(globalPath, 'utf-8')
        const profile = JSON.parse(profileData) as IUserProfile
        log.info('[Profile Manager] Loaded global profile')
        return profile
      }
    } catch (error) {
      log.warn('[Profile Manager] Failed to load global profile:', error)
    }

    return undefined
  }

  /**
   * Load domain-specific profile
   */
  async loadDomainProfile(domain: string): Promise<IUserProfile | undefined> {
    const domainPath = this.getDomainProfilePath(domain)

    try {
      if (existsSync(domainPath)) {
        const profileData = await readFile(domainPath, 'utf-8')
        const profile = JSON.parse(profileData) as IUserProfile
        log.info(`[Profile Manager] Loaded domain-specific profile for ${domain}`)
        return profile
      }
    } catch (error) {
      log.warn(`[Profile Manager] Failed to load domain profile for ${domain}:`, error)
    }

    return undefined
  }

  /**
   * Save user profile with smart reducer
   * @param domain - Domain to save profile for
   * @param profile - User profile to save
   * @param domainSpecific - If true, save to domain file; if false, update global profile (default)
   */
  async saveProfile(domain: string, profile: IUserProfile, domainSpecific = false): Promise<void> {
    try {
      // Ensure base directory exists
      if (!existsSync(this.baseDir)) {
        await mkdir(this.baseDir, { recursive: true })
      }

      if (domainSpecific) {
        // Save to domain-specific file
        const domainPath = this.getDomainProfilePath(domain)
        await writeFile(domainPath, JSON.stringify(profile, null, 2), 'utf-8')
        log.info(`[Profile Manager] Saved domain-specific profile for ${domain}`)
      } else {
        // Update global profile with smart reducer
        const reducedProfile = await this.reduceGlobalProfile(domain, profile)
        const globalPath = this.getGlobalProfilePath()
        await writeFile(globalPath, JSON.stringify(reducedProfile, null, 2), 'utf-8')
        log.info(`[Profile Manager] Updated global profile with data from ${domain}`)
      }
    } catch (error) {
      log.warn(`[Profile Manager] Failed to save profile:`, error)
    }
  }

  /**
   * Check if cookie1 is newer than cookie2 based on expires date
   */
  private isNewerCookie(cookie1: UserProfileCookie, cookie2: UserProfileCookie): boolean {
    if (!cookie1.expires && !cookie2.expires) return true
    if (!cookie2.expires) return true
    if (!cookie1.expires) return false

    const date1 = new Date(cookie1.expires).getTime()
    const date2 = new Date(cookie2.expires).getTime()

    return date1 > date2
  }

  /**
   * Merge two profiles intelligently:
   * - Domain profile overrides global for matching domains
   * - Newer cookies override older ones (by expires date)
   * - Device settings from domain profile take priority
   */
  private mergeProfiles(global: IUserProfile, domain: IUserProfile, targetDomain: string): IUserProfile {
    const merged: IUserProfile = JSON.parse(JSON.stringify(global)) // Deep clone

    // Merge cookies - domain specific cookies override global
    if (domain.cookies && domain.cookies.length > 0) {
      const globalCookies = merged.cookies || []
      const domainCookies = domain.cookies

      // Filter out cookies from global that match the target domain
      const filteredGlobal = globalCookies.filter(
        gc => !gc.domain || !gc.domain.includes(targetDomain.replace('www.', ''))
      )

      // Merge cookies, preferring domain-specific ones
      const cookieMap = new Map<string, (typeof domainCookies)[0]>()

      // Add global cookies first
      for (const cookie of filteredGlobal) {
        cookieMap.set(`${cookie.name}:${cookie.domain}`, cookie)
      }

      // Override with domain cookies (newer ones)
      for (const cookie of domainCookies) {
        const key = `${cookie.name}:${cookie.domain}`
        const existing = cookieMap.get(key)

        if (!existing || this.isNewerCookie(cookie, existing)) {
          cookieMap.set(key, cookie)
        }
      }

      merged.cookies = Array.from(cookieMap.values())
    }

    // Merge storage - domain storage overrides global for matching origins
    if (domain.storage) {
      merged.storage = merged.storage || {}

      for (const [origin, storageData] of Object.entries(domain.storage)) {
        // Domain storage completely overwrites global storage for that origin
        merged.storage[origin] = storageData
      }
    }

    // Device profile from domain takes priority
    if (domain.deviceProfile) {
      merged.deviceProfile = domain.deviceProfile
    }

    // Other fields from domain override global
    if (domain.locale) merged.locale = domain.locale
    if (domain.timezoneId) merged.timezoneId = domain.timezoneId
    if (domain.userAgent) merged.userAgent = domain.userAgent
    if (domain.userAgentString) merged.userAgentString = domain.userAgentString

    return merged
  }

  /**
   * Load profile for a domain with global fallback
   * Load logic: global profile + domain profile (domain overrides global)
   */
  async loadProfile(domain: string): Promise<IUserProfile | undefined> {
    const globalProfile = await this.loadGlobalProfile()
    const domainProfile = await this.loadDomainProfile(domain)

    if (domainProfile && globalProfile) {
      log.info(`[Profile Manager] Merging global profile with domain profile for ${domain}`)
      return this.mergeProfiles(globalProfile, domainProfile, domain)
    }

    if (domainProfile) {
      log.info(`[Profile Manager] Using domain-specific profile for ${domain}`)
      return domainProfile
    }

    if (globalProfile) {
      log.info(`[Profile Manager] Using global profile for ${domain}`)
      return globalProfile
    }

    return undefined
  }

  /**
   * Reduce global profile with new domain data
   * - Overwrites cookies/localStorage for matching domain
   * - Maintains cookies/localStorage for other domains
   */
  private async reduceGlobalProfile(domain: string, newProfile: IUserProfile): Promise<IUserProfile> {
    const globalProfile = (await this.loadGlobalProfile()) || {
      cookies: [],
      storage: {},
      locale: newProfile.locale,
      timezoneId: newProfile.timezoneId,
      userAgent: newProfile.userAgent,
      userAgentString: newProfile.userAgentString,
      deviceProfile: newProfile.deviceProfile
    }

    // Filter out old cookies from this domain
    const domainPattern = domain.replace('www.', '')
    const otherDomainCookies = (globalProfile.cookies || []).filter(
      cookie => !cookie.domain || !cookie.domain.includes(domainPattern)
    )

    // Add new cookies from this domain
    const newDomainCookies = (newProfile.cookies || []).filter(
      cookie => cookie.domain && cookie.domain.includes(domainPattern)
    )

    // Merge cookies
    const mergedCookies = [...otherDomainCookies, ...newDomainCookies]

    // Update storage - replace storage for this domain's origins
    const mergedStorage = { ...globalProfile.storage }
    if (newProfile.storage) {
      for (const [origin, storageData] of Object.entries(newProfile.storage)) {
        // Only update storage if origin matches current domain
        if (origin.includes(domainPattern)) {
          mergedStorage[origin] = storageData
        }
      }
    }

    return {
      ...globalProfile,
      cookies: mergedCookies,
      storage: mergedStorage,
      // Keep device profile updated
      deviceProfile: newProfile.deviceProfile || globalProfile.deviceProfile,
      locale: newProfile.locale || globalProfile.locale,
      timezoneId: newProfile.timezoneId || globalProfile.timezoneId,
      userAgent: newProfile.userAgent || globalProfile.userAgent,
      userAgentString: newProfile.userAgentString || globalProfile.userAgentString
    } satisfies IUserProfile
  }

  /**
   * Get path to global profile file
   */
  private getGlobalProfilePath(): string {
    return join(this.baseDir, 'global-profile.json')
  }

  /**
   * Get path to domain-specific profile file
   */
  private getDomainProfilePath(domain: string): string {
    const profileDir = join(this.baseDir, domain)

    // Ensure directory exists
    if (!existsSync(profileDir)) {
      mkdir(profileDir, { recursive: true }).catch(err => {
        log.warn(`[Profile Manager] Failed to create profile directory for ${domain}:`, err)
      })
    }

    return join(profileDir, 'user-profile.json')
  }
}
