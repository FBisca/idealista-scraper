import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IdealistaDetailParserPlugin } from './idealista-detail-parser.js';
import type { InteractiveParseContext } from '../web-engine/types.js';

const detailHtml = readFileSync(
  resolve(import.meta.dirname, '__fixtures__/idealista-detail.html'),
  'utf-8',
);

const sourceUrl = 'https://www.idealista.com/inmueble/110641394/';
const revealedPhoneHtml = `${detailHtml}<a role="button" class="icon-phone-outline hidden-contact-phones_formatted-phone _mobilePhone" href="tel:+34919387970"><span class="hidden-contact-phones_text">919 38 79 70</span><span tabindex="0" class="phone-type-info phone-type-info--hidden"></span></a>`;

const parseContext: InteractiveParseContext = {
  engine: 'ulixee',
  requestUrl: sourceUrl,
  interaction: {
    click: async () => undefined,
    isVisible: async () => false,
    waitForSelector: async () => false,
    evaluate: async <ResultType>() => undefined as ResultType,
    getHtml: async () => detailHtml,
    getUrl: async () => sourceUrl,
  },
};

describe('IdealistaDetailParserPlugin', () => {
  it('applies for idealista detail pages', () => {
    const plugin = new IdealistaDetailParserPlugin();

    expect(
      plugin.applies({
        content: { url: sourceUrl, data: detailHtml },
        context: { engine: 'ulixee', requestUrl: sourceUrl },
      }),
    ).toBe(true);
  });

  it('does not apply for listing pages', () => {
    const plugin = new IdealistaDetailParserPlugin();

    expect(
      plugin.applies({
        content: {
          url: 'https://www.idealista.com/venta-viviendas/madrid-madrid/',
          data: '',
        },
        context: {
          engine: 'ulixee',
          requestUrl:
            'https://www.idealista.com/venta-viviendas/madrid-madrid/',
        },
      }),
    ).toBe(false);
  });

  it('does not apply for non-idealista domains', () => {
    const plugin = new IdealistaDetailParserPlugin();

    expect(
      plugin.applies({
        content: { url: 'https://example.com/inmueble/12345/', data: '' },
        context: {
          engine: 'ulixee',
          requestUrl: 'https://example.com/inmueble/12345/',
        },
      }),
    ).toBe(false);
  });

  it('extracts id, title, and subtitle', async () => {
    const plugin = new IdealistaDetailParserPlugin();
    const result = await plugin.extract(
      { url: sourceUrl, data: detailHtml },
      parseContext,
    );

    expect(result.id).toBe('110641394');
    expect(result.title).toBe('Piso en venta en CL Embajadores');
    expect(result.subtitle).toBe('Delicias, Madrid');
    expect(result.url).toBe(sourceUrl);
    expect(result.referenceNumber).toBe('110641394');
  });

  it('extracts pricing with price per sqm', async () => {
    const plugin = new IdealistaDetailParserPlugin();
    const result = await plugin.extract(
      { url: sourceUrl, data: detailHtml },
      parseContext,
    );

    expect(result.pricing).toMatchObject({
      price: 290000,
      currency: 'EUR',
      pricePerSqm: 3187,
    });
  });

  it('extracts basic features', async () => {
    const plugin = new IdealistaDetailParserPlugin();
    const result = await plugin.extract(
      { url: sourceUrl, data: detailHtml },
      parseContext,
    );

    expect(result.basicFeatures.constructedAreaSqm).toBe(91);
    expect(result.basicFeatures.rooms).toBe(2);
    expect(result.basicFeatures.bathrooms).toBe(1);
    expect(result.basicFeatures.condition).toBe('Segunda mano/buen estado');
    expect(result.basicFeatures.yearBuilt).toBe(1957);
    expect(result.basicFeatures.raw).toEqual([
      '91 m² construidos',
      '2 habitaciones',
      '1 baño',
      'Segunda mano/buen estado',
      'Construido en 1957',
    ]);
  });

  it('extracts building features', async () => {
    const plugin = new IdealistaDetailParserPlugin();
    const result = await plugin.extract(
      { url: sourceUrl, data: detailHtml },
      parseContext,
    );

    expect(result.buildingFeatures).toBeDefined();
    expect(result.buildingFeatures?.floor).toBe('Planta 2ª');
    expect(result.buildingFeatures?.orientation).toBe('exterior');
    expect(result.buildingFeatures?.elevator).toBe(true);
    expect(result.buildingFeatures?.raw).toEqual([
      'Planta 2ª exterior',
      'Con ascensor',
    ]);
  });

  it('extracts energy certificate ratings', async () => {
    const plugin = new IdealistaDetailParserPlugin();
    const result = await plugin.extract(
      { url: sourceUrl, data: detailHtml },
      parseContext,
    );

    expect(result.energyCertificate).toMatchObject({
      consumption: 'D',
      emissions: 'D',
    });
  });

  it('extracts location with coordinates', async () => {
    const plugin = new IdealistaDetailParserPlugin();
    const result = await plugin.extract(
      { url: sourceUrl, data: detailHtml },
      parseContext,
    );

    expect(result.location.street).toBe('CL EMBAJADORES');
    expect(result.location.barrio).toBe('Barrio Delicias');
    expect(result.location.distrito).toBe('Distrito Arganzuela');
    expect(result.location.city).toBe('Madrid');
    expect(result.location.province).toBe('Madrid capital, Madrid');
    expect(result.location.latitude).toBeCloseTo(40.3965, 3);
    expect(result.location.longitude).toBeCloseTo(-3.6969, 3);
  });

  it('extracts coordinates from raw HTML when #sMap src is missing', async () => {
    const plugin = new IdealistaDetailParserPlugin();
    const htmlWithoutSMapSrc = detailHtml.replace(
      /(<img[^>]*id="sMap"[^>]*?)\s+src="[^"]*"/i,
      '$1',
    );
    const result = await plugin.extract(
      {
        url: sourceUrl,
        data: htmlWithoutSMapSrc,
      },
      parseContext,
    );

    expect(result.location.latitude).toBeCloseTo(40.3965, 3);
    expect(result.location.longitude).toBeCloseTo(-3.6969, 3);
  });

  it('extracts description from advertiser comment', async () => {
    const plugin = new IdealistaDetailParserPlugin();
    const result = await plugin.extract(
      { url: sourceUrl, data: detailHtml },
      parseContext,
    );

    expect(result.description).toBeDefined();
    expect(result.description).toContain('OPORTUNIDAD PARA INVERSORES');
    expect(result.description).toContain('inversión a medio/largo plazo');
  });

  it('extracts tags and housing situation', async () => {
    const plugin = new IdealistaDetailParserPlugin();
    const result = await plugin.extract(
      { url: sourceUrl, data: detailHtml },
      parseContext,
    );

    expect(result.tags).toContain('Ocupada ilegalmente');
    expect(result.housingSituation).toEqual(['Ocupada ilegalmente']);
  });

  it('extracts advertiser info', async () => {
    const plugin = new IdealistaDetailParserPlugin();
    let phoneRevealed = false;
    const context: InteractiveParseContext = {
      ...parseContext,
      interaction: {
        ...parseContext.interaction,
        click: async (selector) => {
          if (selector === '#contact-phones-container') {
            phoneRevealed = true;
          }
        },
        getHtml: async () =>
          phoneRevealed ? detailHtml + revealedPhoneHtml : detailHtml,
      },
    };
    const result = await plugin.extract(
      { url: sourceUrl, data: detailHtml },
      context,
    );

    expect(result.advertiser.name).toBe('Paula');
    expect(result.advertiser.type).toBe('Profesional');
    expect(result.advertiser.profileUrl).toBe(
      'https://www.idealista.com/pro/paola-bambini/',
    );
    expect(result.advertiser.location).toBe('Las Rozas de Madrid');
    expect(result.advertiser.phoneNumber).toBe('+34919387970');
  });

  it('extracts photos count and map availability', async () => {
    const plugin = new IdealistaDetailParserPlugin();
    const result = await plugin.extract(
      { url: sourceUrl, data: detailHtml },
      parseContext,
    );

    expect(result.photosCount).toBe(4);
    expect(result.hasMap).toBe(true);
    expect(result.pictureUrls.length).toBeGreaterThanOrEqual(4);
    expect(
      result.pictureUrls.some((url) => url.includes('1411030240.jpg')),
    ).toBe(true);
  });

  it('extracts last update text', async () => {
    const plugin = new IdealistaDetailParserPlugin();
    const result = await plugin.extract(
      { url: sourceUrl, data: detailHtml },
      parseContext,
    );

    expect(result.lastUpdateText).toBeDefined();
    expect(result.lastUpdateText).toContain('Anuncio actualizado');
  });

  it('uses interaction adapter HTML when available during extract', async () => {
    const plugin = new IdealistaDetailParserPlugin();
    const interactiveHtml = `<div class="main-info__title-main">Piso interactivo</div>${detailHtml}`;

    const context: InteractiveParseContext = {
      engine: 'ulixee-hero',
      requestUrl: sourceUrl,
      interaction: {
        click: async () => undefined,
        isVisible: async () => false,
        waitForSelector: async () => true,
        evaluate: async <ResultType>() => undefined as ResultType,
        getHtml: async () => interactiveHtml,
        getUrl: async () => sourceUrl,
      },
    };

    const result = await plugin.extract(
      { url: sourceUrl, data: detailHtml },
      context,
    );

    expect(result.title).toBe('Piso interactivo');
  });
});
