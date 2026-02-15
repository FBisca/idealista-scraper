import * as cheerio from 'cheerio'
import { ContentParserPlugin, type ParseContext, type PluginEvaluation, type WebContent } from '../web-engine/types.js'

export interface IdealistaAgencyInfo {
	title?: string
	url?: string
	markup?: string
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

export interface IdealistaListing {
	id: string
	label: string
	url: string
	price: IdealistaPriceInfo
	details: IdealistaListingDetails
	description?: string
	tags: string[]
	agency?: IdealistaAgencyInfo
}

export interface IdealistaListParseResult {
	sourceUrl: string
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
			const agency = this.extractAgency(article, content.url, $)

			listings.push({
				id,
				label,
				url: this.toAbsoluteUrl(href, content.url),
				price,
				details,
				...(description ? { description } : {}),
				tags,
				...(agency ? { agency } : {})
			})
		})

		return {
			sourceUrl: content.url,
			listings
		}
	}

	private extractTags(article: ReturnType<cheerio.CheerioAPI>, $: cheerio.CheerioAPI): string[] {
		const tags = article
			.find('.item-tag, .item-label, .tag')
			.map((_, tag) => this.normalizeText($(tag).text()))
			.get()
			.filter(Boolean)

		return [...new Set(tags)]
	}

	private extractAgency(
		article: ReturnType<cheerio.CheerioAPI>,
		sourceUrl: string,
		$: cheerio.CheerioAPI
	): IdealistaAgencyInfo | undefined {
		const footer = article.find('.item-detail-footer, .item-logo').first()
		if (!footer.length) {
			return undefined
		}

		const agencyLink = footer.find('a').first()
		const title = this.optionalText(agencyLink.attr('title') ?? footer.find('.advertiser-name').first().text())
		const href = agencyLink.attr('href')
		const markup = this.optionalText(footer.find('[data-markup]').first().attr('data-markup'))

		const agency: IdealistaAgencyInfo = {
			...(title ? { title } : {}),
			...(href ? { url: this.toAbsoluteUrl(href, sourceUrl) } : {}),
			...(markup ? { markup } : {})
		}

		return Object.keys(agency).length ? agency : undefined
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

		if (content.includes('$')) {
			code = 'USD'
		} else if (content.includes('€')) {
			code = 'EUR'
		} else if (content.includes('£')) {
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
