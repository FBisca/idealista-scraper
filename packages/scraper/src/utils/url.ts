import { log } from '@workspace/logger'
import { parse as parseDomain } from 'psl'

export const extractDomain = (url: string): string => {
  try {
    if (url.trim().length === 0) {
      return ''
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`
    }

    const urlObj = new URL(url)
    const parsed = parseDomain(urlObj.hostname)
    if (!('listed' in parsed)) {
      log.error('Error extracting domain from URL', { url, error: parsed.error })
      return ''
    }

    return parsed.domain || ''
  } catch (error) {
    log.error('Error extracting domain from URL', { url, error })
    return ''
  }
}

export const domainMatches = (url: string, target: string): boolean => {
  return extractDomain(url) === extractDomain(target)
}

export const isValidUrl = (url: string): boolean => {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}
