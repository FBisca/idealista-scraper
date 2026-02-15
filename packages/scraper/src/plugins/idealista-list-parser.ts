import * as cheerio from 'cheerio'
import { ContentParserPlugin, type ParseContext, type PluginEvaluation, type WebContent } from '../web-engine/types.js'

export interface IdealistaAgencyInfo {
	title?: string
	url?: string
	markup?: string
}

export interface IdealistaAgencyDebugCandidate {
	selector: string
	href?: string
	title?: string
	text?: string
	markup?: string
	className?: string
}

export interface IdealistaListingDetails {
	raw: string[]
	rooms?: number
	areaSqm?: number
	floor?: string
}

export interface IdealistaPriceInfo {
	value: number
	originalValue?: number
	discount?: number
	currency: 'EUR' | 'USD' | 'GBP' | 'UNKNOWN'
}

export interface IdealistaAveragePricePerSquareMeter {
	value: number
	currency: 'EUR' | 'USD' | 'GBP' | 'UNKNOWN'
}

export interface IdealistaPaginationInfo {
	currentPage: number
	nextPageUrl?: string
}

export interface IdealistaListing {
	id: string
	label: string
	url: string
	price: IdealistaPriceInfo
	includedParking: boolean
	details: IdealistaListingDetails
	description?: string
	tags: string[]
	agency?: IdealistaAgencyInfo
}

export interface IdealistaListParseResult {
	sourceUrl: string
	pagination: IdealistaPaginationInfo
	totalItems?: number
	averagePricePerSquareMeter?: IdealistaAveragePricePerSquareMeter
	listings: IdealistaListing[]
}

export class IdealistaListParserPlugin extends ContentParserPlugin<string, IdealistaListParseResult> {
	public readonly name = 'idealista-list-parser'

	public applies({ content, context }: PluginEvaluation<string>): boolean {
		const url = context.finalUrl ?? context.requestUrl ?? content.url
		const domain = context.page?.domain ?? this.safeDomainFromUrl(url)

		if (!domain.endsWith('idealista.com')) {
			return false
		}

		return /\/venta-viviendas\/|\/alquiler-viviendas\//i.test(url)
	}

	public async extract(content: WebContent<string>, _context?: ParseContext): Promise<IdealistaListParseResult> {
		const $ = cheerio.load(content.data)
		const listings: IdealistaListing[] = []
		const nextPageHref = this.optionalText($('.pagination li.next a').first().attr('href'))
		const currentPage = this.extractCurrentPage($)
		const totalItems = this.extractTotalItems($)
		const averagePricePerSquareMeter = this.extractAveragePricePerSquareMeter($)

		$('article.item').each((_, element) => {
			const article = $(element)
			const linkElement = article.find('.item-link').first()
			const href = linkElement.attr('href')
			const label = this.normalizeText(linkElement.text())
			const currentPrice = this.normalizeText(article.find('.item-price').first().text())

			if (!href || !label || !currentPrice) {
				return
			}

			const id =
				article.attr('data-element-id') ??
				article.attr('data-adid') ??
				this.extractIdFromHref(href) ??
				this.extractIdFromLabel(label)

			if (!id) {
				return
			}

			const detailsRaw = article
				.find('.item-detail-char')
				.map((__, detail) => this.normalizeText($(detail).text()))
				.get()
				.filter(Boolean)

			const detailsText = detailsRaw.join(' | ')
			const details: IdealistaListingDetails = {
				raw: detailsRaw,
				rooms: this.extractRooms(detailsText),
				areaSqm: this.extractAreaSqm(detailsText),
				floor: this.extractFloor(detailsText)
			}

			const description = this.optionalText(article.find('.item-description, .item-paragraph').first().text())
			const tags = this.extractTags(article, $)
			const originalPrice = this.optionalText(
				article.find('.pricedown_price, .item-price-discount, .item-price--discount').first().text()
			)
			const price = this.buildPriceInfo(currentPrice, originalPrice)
			const includedParking = article.find('.price-row .item-parking').length > 0
			const agencyCandidates = this.collectAgencyCandidates(article, content.url, $)
			const agency = this.resolveAgencyFromCandidates(agencyCandidates)

			listings.push({
				id,
				label,
				url: this.toAbsoluteUrl(href, content.url),
				price,
				includedParking,
				details,
				...(description ? { description } : {}),
				tags,
				...(agency ? { agency } : {})
			})
		})

		return {
			sourceUrl: content.url,
			pagination: {
				currentPage,
				...(nextPageHref ? { nextPageUrl: this.toAbsoluteUrl(nextPageHref, content.url) } : {})
			},
			...(totalItems ? { totalItems } : {}),
			...(averagePricePerSquareMeter ? { averagePricePerSquareMeter } : {}),
			listings
		}
	}

	private extractCurrentPage($: cheerio.CheerioAPI): number {
		const currentPageText = this.optionalText($('.pagination li.selected span').first().text())
		if (!currentPageText) {
			return 1
		}

		const parsedPage = Number(currentPageText)
		if (!Number.isFinite(parsedPage) || parsedPage <= 0) {
			return 1
		}

		return Math.trunc(parsedPage)
	}

	private extractTotalItems($: cheerio.CheerioAPI): number | undefined {
		const text = this.optionalText($('.breadcrumb-navigation-element-info').first().text())
		if (!text) {
			return undefined
		}

		const match = text.match(/([\d.]+)\s+con\s+tu[s]?\s+criterios/i)
		if (!match?.[1]) {
			return undefined
		}

		const normalized = match[1].replace(/\./g, '')
		const parsedValue = Number(normalized)

		if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
			return undefined
		}

		return parsedValue
	}

	private extractAveragePricePerSquareMeter($: cheerio.CheerioAPI): IdealistaAveragePricePerSquareMeter | undefined {
		const text = this.optionalText($('.items-average-price').first().text())
		if (!text) {
			return undefined
		}

		const value = this.parsePriceValue(text)
		if (!value) {
			return undefined
		}

		return {
			value,
			currency: this.parseCurrencyCode(text)
		}
	}

	private extractTags(article: ReturnType<cheerio.CheerioAPI>, $: cheerio.CheerioAPI): string[] {
		const tags = article
			.find('.item-tag, .item-label, .tag, .listing-tags, .listing-tags-container .listing-tags')
			.map((_, tag) => this.normalizeText($(tag).text()))
			.get()
			.filter(Boolean)

		return [...new Set(tags)]
	}

	private collectAgencyCandidates(
		article: ReturnType<cheerio.CheerioAPI>,
		sourceUrl: string,
		$: cheerio.CheerioAPI
	): IdealistaAgencyDebugCandidate[] {
		const selectors = [
			'picture.logo-branding a[href]',
			'.logo-branding a[href]',
			'[class*="logo-branding"] a[href]',
			'.item-detail-footer a[href]',
			'.item-logo a[href]',
			'.advertiser-name a[href]',
			'a[href*="/pro/"]',
			'a[href*="/inmobiliaria"]',
			'a[data-markup]',
			'.item-detail-footer [data-markup]',
			'.item-logo [data-markup]',
			'[data-markup]'
		]

		const candidates: IdealistaAgencyDebugCandidate[] = []
		const seen = new Set<string>()

		for (const selector of selectors) {
			article.find(selector).each((_, element) => {
				const link = $(element)
				const closestAnchor = link.is('a') ? link : link.closest('a')
				const hrefRaw = this.optionalText(link.attr('href') ?? closestAnchor.attr('href'))
				const title = this.optionalText(link.attr('title') ?? closestAnchor.attr('title'))
				const text = this.optionalText(link.text())
				const markup = this.optionalText(link.attr('data-markup'))
				const className = this.optionalText(link.attr('class'))

				const isListingLink = Boolean(className?.includes('item-link') || hrefRaw?.includes('/inmueble/'))
				if (isListingLink) {
					return
				}

				if (!hrefRaw && !title && !text && !markup) {
					return
				}

				const href = hrefRaw ? this.toAbsoluteUrl(hrefRaw, sourceUrl) : undefined
				const fingerprint = `${selector}|${href ?? ''}|${title ?? ''}|${text ?? ''}|${markup ?? ''}`
				if (seen.has(fingerprint)) {
					return
				}

				seen.add(fingerprint)
				candidates.push({
					selector,
					...(href ? { href } : {}),
					...(title ? { title } : {}),
					...(text ? { text } : {}),
					...(markup ? { markup } : {}),
					...(className ? { className } : {})
				})
			})
		}

		return candidates
	}

	private resolveAgencyFromCandidates(candidates: IdealistaAgencyDebugCandidate[]): IdealistaAgencyInfo | undefined {
		if (!candidates.length) {
			return undefined
		}

		const preferredCandidate =
			candidates.find(candidate => candidate.selector.includes('logo-branding') && Boolean(candidate.href)) ??
			candidates.find(candidate => candidate.href?.includes('/pro/')) ??
			candidates.find(candidate => candidate.href?.includes('/inmobiliaria')) ??
			candidates[0]

		if (!preferredCandidate) {
			return undefined
		}

		const markupFromSameHref = preferredCandidate.href
			? candidates.find(candidate => candidate.href === preferredCandidate.href && candidate.markup)?.markup
			: undefined

		const title =
			preferredCandidate.title ?? preferredCandidate.text ?? this.inferAgencyTitleFromHref(preferredCandidate.href)
		const agency: IdealistaAgencyInfo = {
			...(title ? { title } : {}),
			...(preferredCandidate.href ? { url: preferredCandidate.href } : {}),
			...(preferredCandidate.markup || markupFromSameHref
				? { markup: preferredCandidate.markup ?? markupFromSameHref }
				: {})
		}

		return Object.keys(agency).length ? agency : undefined
	}

	private inferAgencyTitleFromHref(href?: string): string | undefined {
		if (!href) {
			return undefined
		}

		const match = href.match(/\/pro\/([^/]+)/i)
		return this.optionalText(match?.[1])
	}

	private extractRooms(details: string): number | undefined {
		const match = details.match(/(\d+)\s*hab\./i)
		return match ? Number(match[1]) : undefined
	}

	private extractAreaSqm(details: string): number | undefined {
		const match = details.match(/(\d+)\s*m²/i)
		return match ? Number(match[1]) : undefined
	}

	private extractFloor(details: string): string | undefined {
		const match = details.match(/(Planta[^|]*)/i)
		return this.optionalText(match?.[1])
	}

	private buildPriceInfo(currentPrice: string, originalPrice?: string): IdealistaPriceInfo {
		const currentValue = this.parsePriceValue(currentPrice) ?? 0
		const originalValue = originalPrice ? this.parsePriceValue(originalPrice) : undefined
		const currency = this.parseCurrencyCode(currentPrice)

		if (!originalValue || originalValue <= currentValue) {
			return {
				value: currentValue,
				currency
			}
		}

		const discount = Math.round(((originalValue - currentValue) / originalValue) * 100)

		return {
			value: currentValue,
			originalValue,
			...(discount > 0 ? { discount } : {}),
			currency
		}
	}

	private parseCurrencyCode(content: string): IdealistaPriceInfo['currency'] {
		let code: IdealistaPriceInfo['currency'] = 'UNKNOWN'

		if (content.includes('$') || /USD|\$/.test(content)) {
			code = 'USD'
		} else if (content.includes('€') || /EUR|€/i.test(content)) {
			code = 'EUR'
		} else if (content.includes('£') || /GBP|£/.test(content)) {
			code = 'GBP'
		}

		return code
	}

	private parsePriceValue(price: string): number | undefined {
		const numericMatch = price.match(/[\d.,]+/)
		if (!numericMatch) {
			return undefined
		}

		const normalized = numericMatch[0].replace(/\./g, '').replace(',', '.')
		const value = Number(normalized)

		if (!Number.isFinite(value) || value <= 0) {
			return undefined
		}

		return value
	}

	private extractIdFromHref(href: string): string | undefined {
		const match = href.match(/\/(\d+)\/?$/)
		return match?.[1]
	}

	private extractIdFromLabel(label: string): string | undefined {
		const match = label.match(/\b(\d{7,})\b/)
		return match?.[1]
	}

	private normalizeText(value: string): string {
		return value.replace(/\s+/g, ' ').trim()
	}

	private optionalText(value: string | undefined): string | undefined {
		if (!value) {
			return undefined
		}

		const normalized = this.normalizeText(value)
		return normalized.length ? normalized : undefined
	}

	private toAbsoluteUrl(candidate: string, base: string): string {
		try {
			return new URL(candidate, base).toString()
		} catch {
			return candidate
		}
	}

	private safeDomainFromUrl(url: string): string {
		try {
			return new URL(url).hostname
		} catch {
			return ''
		}
	}
}
