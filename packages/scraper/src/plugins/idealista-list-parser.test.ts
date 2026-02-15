import { describe, expect, it } from 'vitest'
import { IdealistaListParserPlugin } from './idealista-list-parser.js'

const listingHtml = `
<!doctype html>
<html lang="es">
  <body>
    <main class="items-container">
      <article class="item item-multimedia-container" data-element-id="110081746">
        <div class="item-info-container">
          <a class="item-link" href="/inmueble/110081746/">Piso en Calle de Vélez Rubio, Apóstol Santiago, Madrid</a>
          <span class="item-price">317.000€</span>
          <span class="pricedown_price">322.000 €</span>
          <span class="item-detail-char">2 hab.\n50 m²\nPlanta 2ª exterior con ascensor</span>
          <p class="item-description">Vivienda luminosa en zona tranquila.</p>
          <span class="item-tag">Visita 3D</span>
          <span class="item-tag">Anuncio profesional</span>
        </div>
        <footer class="item-detail-footer">
          <a title="Best Homes" href="/pro/best-homes/">Best Homes</a>
          <span data-markup="agency-pro"></span>
        </footer>
      </article>
      <article class="item item-multimedia-container" data-element-id="110081111">
        <div class="item-info-container">
          <a class="item-link" href="/inmueble/110081111/">Piso en Calle Falsa, Madrid</a>
          <span class="item-price">250.000€</span>
          <span class="item-detail-char">1 hab. 40 m² Planta 3ª exterior con ascensor</span>
        </div>
      </article>
    </main>
  </body>
</html>
`

describe('IdealistaListParserPlugin', () => {
  it('applies for idealista listing pages', () => {
    const plugin = new IdealistaListParserPlugin()

    const applies = plugin.applies({
      content: { url: 'https://www.idealista.com/venta-viviendas/madrid-madrid/', data: listingHtml },
      context: {
        engine: 'ulixee',
        requestUrl: 'https://www.idealista.com/venta-viviendas/madrid-madrid/'
      }
    })

    expect(applies).toBe(true)
  })

  it('extracts listing fields with optional agency and discount price', async () => {
    const plugin = new IdealistaListParserPlugin()

    const parsed = await plugin.extract({
      url: 'https://www.idealista.com/venta-viviendas/madrid-madrid/',
      data: listingHtml
    })

    expect(parsed.sourceUrl).toBe('https://www.idealista.com/venta-viviendas/madrid-madrid/')
    expect(parsed.listings).toHaveLength(2)

    const firstListing = parsed.listings[0]
    const secondListing = parsed.listings[1]

    if (!firstListing || !secondListing) {
      throw new Error('Expected two listings in parsed output')
    }

    expect(firstListing).toMatchObject({
      id: '110081746',
      label: 'Piso en Calle de Vélez Rubio, Apóstol Santiago, Madrid',
      url: 'https://www.idealista.com/inmueble/110081746/',
      price: {
        value: 317000,
        originalValue: 322000,
        discount: 2,
        currency: 'EUR'
      },
      details: {
        rooms: 2,
        areaSqm: 50,
        floor: 'Planta 2ª exterior con ascensor'
      },
      description: 'Vivienda luminosa en zona tranquila.',
      tags: ['Visita 3D', 'Anuncio profesional'],
      agency: {
        title: 'Best Homes',
        url: 'https://www.idealista.com/pro/best-homes/',
        markup: 'agency-pro'
      }
    })

    expect(secondListing).toMatchObject({
      id: '110081111',
      label: 'Piso en Calle Falsa, Madrid',
      price: {
        value: 250000,
        currency: 'EUR'
      },
      details: {
        rooms: 1,
        areaSqm: 40,
        floor: 'Planta 3ª exterior con ascensor'
      },
      tags: []
    })
    expect(secondListing.agency).toBeUndefined()
  })
})
