import * as cheerio from 'cheerio';
import {
  InteractiveContentParserPlugin,
  InteractiveParseContext,
  type PluginEvaluation,
  type WebContent,
} from '../web-engine/types.js';

type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'UNKNOWN';

export interface IdealistaDetailPricing {
  price: number;
  currency: CurrencyCode;
  pricePerSqm?: number;
}

export interface IdealistaDetailBasicFeatures {
  raw: string[];
  constructedAreaSqm?: number;
  rooms?: number;
  bathrooms?: number;
  condition?: string;
  yearBuilt?: number;
}

export interface IdealistaDetailBuildingFeatures {
  raw: string[];
  floor?: string;
  orientation?: 'exterior' | 'interior';
  elevator?: boolean;
}

export interface IdealistaDetailEnergyCertificate {
  consumption?: string;
  emissions?: string;
}

export interface IdealistaDetailLocation {
  street?: string;
  barrio?: string;
  distrito?: string;
  city?: string;
  province?: string;
  latitude?: number;
  longitude?: number;
}

export interface IdealistaDetailAdvertiser {
  name?: string;
  type?: string;
  profileUrl?: string;
  location?: string;
}

export interface IdealistaDetailParseResult {
  id: string;
  url: string;
  title: string;
  subtitle?: string;
  pictureUrls: string[];
  pricing: IdealistaDetailPricing;
  basicFeatures: IdealistaDetailBasicFeatures;
  buildingFeatures?: IdealistaDetailBuildingFeatures;
  energyCertificate?: IdealistaDetailEnergyCertificate;
  location: IdealistaDetailLocation;
  description?: string;
  tags: string[];
  housingSituation?: string[];
  advertiser: IdealistaDetailAdvertiser;
  referenceNumber: string;
  photosCount: number;
  hasMap: boolean;
  lastUpdateText?: string;
}

export class IdealistaDetailParserPlugin extends InteractiveContentParserPlugin<
  string,
  IdealistaDetailParseResult
> {
  public readonly name = 'idealista-detail-parser';

  public applies({ content, context }: PluginEvaluation<string>): boolean {
    const url = context.finalUrl ?? context.requestUrl ?? content.url;
    const domain = context.page?.domain ?? this.safeDomainFromUrl(url);

    if (!domain.endsWith('idealista.com')) {
      return false;
    }

    return /\/inmueble\/\d+/i.test(url);
  }

  public async extract(
    content: WebContent<string>,
    context: InteractiveParseContext,
  ): Promise<IdealistaDetailParseResult> {
    const html = await this.resolveHtml(content.data, context);
    const $ = cheerio.load(html);

    const id = this.extractId($, content.url);
    const title = this.normalizeText(
      $('.main-info__title-main').first().text(),
    );
    const subtitle = this.optionalText(
      $('.main-info__title-minor').first().text(),
    );
    const pictureUrls = this.extractPictureUrls($, content.url);
    const pricing = this.extractPricing($);
    const basicFeatures = this.extractBasicFeatures($);
    const buildingFeatures = this.extractBuildingFeatures($);
    const energyCertificate = this.extractEnergyCertificate($);
    const location = this.extractLocation($, html);
    const description = this.extractDescription($);
    const tags = this.extractTags($);
    const housingSituation = this.extractHousingSituation($);
    const advertiser = this.extractAdvertiser($, content.url);
    const referenceNumber =
      this.normalizeText($('.txt-ref').first().text()) || id;
    const photosCount = this.extractPhotosCount($);
    const hasMap =
      $(
        'button[data-button-type="map"], .multimedia-shortcuts-button[data-button-type="map"]',
      ).length > 0;
    const lastUpdateText =
      this.optionalText($('.date-update-text').first().text()) ??
      this.optionalText($('#stats .stats-text').first().text());

    return {
      id,
      url: content.url,
      title,
      ...(subtitle ? { subtitle } : {}),
      pictureUrls,
      pricing,
      basicFeatures,
      ...(buildingFeatures ? { buildingFeatures } : {}),
      ...(energyCertificate ? { energyCertificate } : {}),
      location,
      ...(description ? { description } : {}),
      tags,
      ...(housingSituation?.length ? { housingSituation } : {}),
      advertiser,
      referenceNumber,
      photosCount,
      hasMap,
      ...(lastUpdateText ? { lastUpdateText } : {}),
    };
  }

  private async resolveHtml(
    fallbackHtml: string,
    context: InteractiveParseContext,
  ): Promise<string> {
    const interaction = context.interaction;

    const candidateSelectors = [
      '.comment button',
      '.comment [data-test="show-more"]',
      '.comment [aria-expanded="false"]',
    ];

    for (const selector of candidateSelectors) {
      const exists = await interaction.waitForSelector(selector, 300);
      if (!exists) {
        continue;
      }

      try {
        await interaction.click(selector);
        const html = await interaction.getHtml();
        if (this.optionalText(html)) {
          return html;
        }
      } catch {
        continue;
      }
    }

    return fallbackHtml;
  }

  private extractId($: cheerio.CheerioAPI, url: string): string {
    const inputId = this.optionalText(
      $('input[name="adId"]').first().val()?.toString(),
    );
    if (inputId) {
      return inputId;
    }

    const refId = this.optionalText($('.txt-ref').first().text());
    if (refId) {
      return refId;
    }

    const urlMatch = url.match(/\/inmueble\/(\d+)/);
    return urlMatch?.[1] ?? '';
  }

  private extractPricing($: cheerio.CheerioAPI): IdealistaDetailPricing {
    const priceText = this.normalizeText($('.info-data-price').first().text());
    const price = this.parsePriceValue(priceText) ?? 0;
    const currency = this.parseCurrencyCode(priceText);

    const sqmText = this.normalizeText(
      $('.squaredmeterprice .flex-feature-details').last().text(),
    );
    const pricePerSqm = this.parsePriceValue(sqmText);

    return {
      price,
      currency,
      ...(pricePerSqm ? { pricePerSqm } : {}),
    };
  }

  private extractBasicFeatures(
    $: cheerio.CheerioAPI,
  ): IdealistaDetailBasicFeatures {
    const items = this.extractFeatureSection($, 'Características básicas');

    return {
      raw: items,
      constructedAreaSqm: this.parseNumericMatch(items, /(\d+)\s*m²/i),
      rooms: this.parseNumericMatch(items, /(\d+)\s*habitaci[oó]n/i),
      bathrooms: this.parseNumericMatch(items, /(\d+)\s*baño/i),
      condition: this.findMatchingItem(
        items,
        /segunda mano|obra nueva|a reformar|en ruinas|buen estado|para reformar/i,
      ),
      yearBuilt: this.parseNumericMatch(items, /construido en\s+(\d{4})/i),
    };
  }

  private extractBuildingFeatures(
    $: cheerio.CheerioAPI,
  ): IdealistaDetailBuildingFeatures | undefined {
    const items = this.extractFeatureSection($, 'Edificio');
    if (!items.length) {
      return undefined;
    }

    const floorItem = items.find((item) => /planta/i.test(item));
    const floor = floorItem
      ? this.optionalText(floorItem.replace(/(exterior|interior)/i, '').trim())
      : undefined;

    const orientationItem = items.find((item) =>
      /exterior|interior/i.test(item),
    );
    const orientationMatch = orientationItem?.match(/(exterior|interior)/i);
    const orientation = orientationMatch?.[1]
      ? (orientationMatch[1].toLowerCase() as 'exterior' | 'interior')
      : undefined;

    const elevator = items.some((item) => /con ascensor/i.test(item))
      ? true
      : items.some((item) => /sin ascensor/i.test(item))
        ? false
        : undefined;

    return {
      raw: items,
      ...(floor ? { floor } : {}),
      ...(orientation ? { orientation } : {}),
      ...(elevator !== undefined ? { elevator } : {}),
    };
  }

  private extractEnergyCertificate(
    $: cheerio.CheerioAPI,
  ): IdealistaDetailEnergyCertificate | undefined {
    const featureTwo = $('.details-property-feature-two');
    if (!featureTwo.length) {
      return undefined;
    }

    const listItems = featureTwo.find('.details-property_features li');
    if (!listItems.length) {
      return undefined;
    }

    let consumption: string | undefined;
    let emissions: string | undefined;

    listItems.each((_, element) => {
      const item = $(element);
      const label = this.normalizeText(item.find('span').first().text());
      const ratingSpan = item.find('span[class*="icon-energy-c-"]');

      if (!ratingSpan.length) {
        return;
      }

      const className = ratingSpan.attr('class') ?? '';
      const ratingMatch = className.match(/icon-energy-c-([a-g])/i);
      const rating = ratingMatch?.[1]?.toUpperCase();

      if (!rating) {
        return;
      }

      if (/consumo/i.test(label)) {
        consumption = rating;
      } else if (/emisi[oó]n/i.test(label)) {
        emissions = rating;
      }
    });

    if (!consumption && !emissions) {
      return undefined;
    }

    return {
      ...(consumption ? { consumption } : {}),
      ...(emissions ? { emissions } : {}),
    };
  }

  private extractLocation(
    $: cheerio.CheerioAPI,
    rawHtml: string,
  ): IdealistaDetailLocation {
    const locationItems = $('#headerMap .header-map-list')
      .map((_, element) => this.normalizeText($(element).text()))
      .get()
      .filter(Boolean);

    const coordinates = this.extractCoordinates($, rawHtml);

    return {
      ...(locationItems[0] ? { street: locationItems[0] } : {}),
      ...(locationItems[1] ? { barrio: locationItems[1] } : {}),
      ...(locationItems[2] ? { distrito: locationItems[2] } : {}),
      ...(locationItems[3] ? { city: locationItems[3] } : {}),
      ...(locationItems[4] ? { province: locationItems[4] } : {}),
      ...(coordinates?.latitude !== undefined
        ? { latitude: coordinates.latitude }
        : {}),
      ...(coordinates?.longitude !== undefined
        ? { longitude: coordinates.longitude }
        : {}),
    };
  }

  private extractCoordinates(
    $: cheerio.CheerioAPI,
    rawHtml: string,
  ): { latitude: number; longitude: number } | undefined {
    const mapSrc = $('#sMap').attr('src') ?? undefined;
    const centerMatch =
      this.extractCenterMatch(mapSrc) ?? this.extractCenterMatch(rawHtml);
    if (!centerMatch?.[1] || !centerMatch?.[2]) {
      return undefined;
    }

    const latitude = Number(centerMatch[1]);
    const longitude = Number(centerMatch[2]);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return undefined;
    }

    return { latitude, longitude };
  }

  private extractCenterMatch(value?: string): RegExpMatchArray | null {
    if (!value) {
      return null;
    }

    return value.match(
      /center=([+-]?\d+(?:\.\d+)?)(?:%2C|,)([+-]?\d+(?:\.\d+)?)/i,
    );
  }

  private extractDescription($: cheerio.CheerioAPI): string | undefined {
    const commentDiv = $('.comment .adCommentsLanguage');
    if (!commentDiv.length) {
      return undefined;
    }

    const paragraphs = commentDiv
      .find('p')
      .map((_, element) => this.normalizeText($(element).text()))
      .get()
      .filter(Boolean);

    const description = paragraphs.join('\n');
    return this.optionalText(description);
  }

  private extractTags($: cheerio.CheerioAPI): string[] {
    const tags = $('.detail-info-tags .tag')
      .map((_, element) => this.normalizeText($(element).text()))
      .get()
      .filter(Boolean);

    return [...new Set(tags)];
  }

  private extractHousingSituation($: cheerio.CheerioAPI): string[] | undefined {
    const items = this.extractFeatureSection($, 'Situación de la vivienda');
    return items.length ? items : undefined;
  }

  private extractAdvertiser(
    $: cheerio.CheerioAPI,
    sourceUrl: string,
  ): IdealistaDetailAdvertiser {
    const nameEl = $(
      '.advertiser-name-container .about-advertiser-name',
    ).first();
    const name =
      this.optionalText(nameEl.text()) ??
      this.optionalText(nameEl.attr('title')) ??
      this.optionalText($('.professional-name span').first().text());

    const type = this.optionalText(
      $('.professional-name .name').first().text(),
    );

    const profileHref = this.optionalText(
      $('.advertiser-name-container a.about-advertiser-name[href]')
        .first()
        .attr('href'),
    );
    const profileUrl = profileHref
      ? this.toAbsoluteUrl(profileHref, sourceUrl)
      : undefined;

    const location = this.optionalText(
      $('.advertiser-name-container').first().find('span').last().text(),
    );
    const advertiserLocation =
      location && location !== name ? location : undefined;

    return {
      ...(name ? { name } : {}),
      ...(type ? { type } : {}),
      ...(profileUrl ? { profileUrl } : {}),
      ...(advertiserLocation ? { location: advertiserLocation } : {}),
    };
  }

  private extractPhotosCount($: cheerio.CheerioAPI): number {
    const buttonText = this.optionalText(
      $(
        '.multimedia-shortcuts-button[data-button-type="pics"] .multimedia-shortcuts-button-text',
      )
        .first()
        .text(),
    );
    if (buttonText) {
      const match = buttonText.match(/(\d+)/);
      if (match?.[1]) {
        return Number(match[1]);
      }
    }

    const counterText = this.optionalText(
      $('.item-multimedia-pictures__counter span').last().text(),
    );
    if (counterText) {
      const parsed = Number(counterText);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return 0;
  }

  private extractPictureUrls(
    $: cheerio.CheerioAPI,
    sourceUrl: string,
  ): string[] {
    const collected = new Set<string>();

    const addUrl = (candidate?: string) => {
      if (!candidate) {
        return;
      }

      const normalized = this.normalizePictureCandidate(candidate);
      if (!normalized) {
        return;
      }

      try {
        collected.add(new URL(normalized, sourceUrl).toString());
      } catch {
        collected.add(normalized);
      }
    };

    $('.detail-image-gallery').each((_, element) => {
      const image = $(element);
      addUrl(image.attr('data-service'));
      addUrl(image.attr('src'));
    });

    $(
      '.main-image picture source[srcset], .placeholder-multimedia picture source[srcset]',
    ).each((_, element) => {
      const sourceSet = $(element).attr('srcset');
      addUrl(sourceSet);
    });

    return [...collected];
  }

  private normalizePictureCandidate(candidate: string): string | undefined {
    const firstEntry = candidate.split(',')[0]?.trim();
    if (!firstEntry) {
      return undefined;
    }

    const urlPart = firstEntry.split(/\s+/)[0]?.trim();
    if (!urlPart || !/^https?:\/\//i.test(urlPart)) {
      return undefined;
    }

    return urlPart;
  }

  private extractFeatureSection(
    $: cheerio.CheerioAPI,
    sectionTitle: string,
  ): string[] {
    let targetList: ReturnType<cheerio.CheerioAPI> | undefined;

    $('.details-property-h2').each((_, heading) => {
      const headingText = this.normalizeText($(heading).text());
      if (headingText.toLowerCase().includes(sectionTitle.toLowerCase())) {
        const sibling = $(heading).next('.details-property_features');
        if (sibling.length) {
          targetList = sibling.find('li');
        }
      }
    });

    if (!targetList?.length) {
      return [];
    }

    return targetList
      .map((_, element) => {
        const item = $(element);
        const linkText = item.find('a').text();
        const fullText = item.text();
        const cleaned = linkText
          ? fullText.replace(linkText, '').trim()
          : fullText;
        return this.normalizeText(cleaned);
      })
      .get()
      .filter(Boolean);
  }

  private parseNumericMatch(
    items: string[],
    pattern: RegExp,
  ): number | undefined {
    for (const item of items) {
      const match = item.match(pattern);
      if (match?.[1]) {
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > 0) {
          return value;
        }
      }
    }
    return undefined;
  }

  private findMatchingItem(
    items: string[],
    pattern: RegExp,
  ): string | undefined {
    for (const item of items) {
      if (pattern.test(item)) {
        return item;
      }
    }
    return undefined;
  }

  private parseCurrencyCode(content: string): CurrencyCode {
    if (content.includes('$') || /USD|\$/.test(content)) {
      return 'USD';
    }
    if (content.includes('€') || /EUR|€/i.test(content)) {
      return 'EUR';
    }
    if (content.includes('£') || /GBP|£/.test(content)) {
      return 'GBP';
    }
    return 'UNKNOWN';
  }

  private parsePriceValue(price: string): number | undefined {
    const numericMatch = price.match(/[\d.,]+/);
    if (!numericMatch) {
      return undefined;
    }

    const normalized = numericMatch[0].replace(/\./g, '').replace(',', '.');
    const value = Number(normalized);

    if (!Number.isFinite(value) || value <= 0) {
      return undefined;
    }

    return value;
  }

  private normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private optionalText(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = this.normalizeText(value);
    return normalized.length ? normalized : undefined;
  }

  private toAbsoluteUrl(candidate: string, base: string): string {
    try {
      return new URL(candidate, base).toString();
    } catch {
      return candidate;
    }
  }

  private safeDomainFromUrl(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }
}
