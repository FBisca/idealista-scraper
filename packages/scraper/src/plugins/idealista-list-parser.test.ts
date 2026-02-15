import { describe, expect, it } from 'vitest'
import { IdealistaListParserPlugin } from './idealista-list-parser.js'

const listingHtml = `
<!doctype html>
<html lang="es">
  <body>
    <main class="items-container">
      <span class="breadcrumb-navigation-element-info">
        1.004 con tus criterios de
        <a href="/venta-viviendas/madrid-madrid/">14.924 en Madrid</a>
      </span>
      <article class="item item-multimedia-container" data-element-id="110081746">
        <div class="item-info-container">
        <picture class="logo-branding">
            <a href="/pro/altorasesores/" data-markup="listado::logo-agencia" title="Altor Asesores" data-click="1">
                <img loading="lazy" src="https://st3.idealista.com/c1/bd/1f/altorasesores.gif" alt="Altor Asesores">
            </a>
        </picture>
          <a class="item-link" href="/inmueble/110081746/">Piso en Calle de Vélez Rubio, Apóstol Santiago, Madrid</a>
          <span class="item-price">317.000€</span>
          <span class="pricedown_price">322.000 €</span>
          <span class="item-detail-char">2 hab.\n50 m²\nPlanta 2ª exterior con ascensor</span>
          <p class="item-description">Vivienda luminosa en zona tranquila.</p>
          <div class="listing-tags-container">
            <span class="listing-tags ">Alquilada</span>
            <span class="listing-tags ">Apartamento</span>
          </div>
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
      <article class="item item-multimedia-container" data-element-id="110081222">
        <div class="item-info-container">
          <a class="item-link" href="/inmueble/110081222/">Piso en Calle Agencia, Madrid</a>
          <span class="item-price">300.000€</span>
          <span class="item-detail-char">2 hab. 70 m² Planta 1ª exterior con ascensor</span>
          <span class="advertiser-name">
            <a href="/pro/agencia-top/" title="Agencia Top" data-markup="agency-highlight">Agencia Top</a>
          </span>
        </div>
      </article>
      <article class="item item-multimedia-container" data-element-id="110081333">
        <div class="item-info-container">
          <a class="item-link" href="/inmueble/110081333/">Piso en Calle Pro Link, Madrid</a>
          <span class="item-price">280.000€</span>
          <span class="item-detail-char">2 hab. 60 m² Planta 4ª exterior con ascensor</span>
          <a href="/pro/huspy/" title="Huspy" data-markup="listado::logo-agencia"></a>
        </div>
      </article>
      <div class="pagination">
        <ul>
          <li class="moreresults"><span>Ver más resultados:</span></li>
          <li class="selected"><span>1</span></li>
          <li>
            <a
              rel="nofollow"
              href="/venta-viviendas/madrid-madrid/con-precio-hasta_360000,precio-desde_175000,metros-cuadrados-mas-de_40,solo-pisos,ascensor,plantas-intermedias,buen-estado/pagina-2.htm"
              >2</a
            >
          </li>
          <li class="next">
            <a
              rel="nofollow"
              class="icon-arrow-right-after"
              href="/venta-viviendas/madrid-madrid/con-precio-hasta_360000,precio-desde_175000,metros-cuadrados-mas-de_40,solo-pisos,ascensor,plantas-intermedias,buen-estado/pagina-2.htm"
              ><span>Siguiente</span></a
            >
          </li>
        </ul>
      </div>
      <p class="items-average-price">Precio medio 4.221 eur/m²</p>
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
    expect(parsed.pagination).toMatchObject({
      currentPage: 1,
      nextPageUrl:
        'https://www.idealista.com/venta-viviendas/madrid-madrid/con-precio-hasta_360000,precio-desde_175000,metros-cuadrados-mas-de_40,solo-pisos,ascensor,plantas-intermedias,buen-estado/pagina-2.htm'
    })
    expect(parsed.totalItems).toBe(1004)
    expect(parsed.averagePricePerSquareMeter).toMatchObject({
      value: 4221,
      currency: 'EUR'
    })
    expect(parsed.listings).toHaveLength(4)

    const firstListing = parsed.listings[0]
    const secondListing = parsed.listings[1]
    const thirdListing = parsed.listings[2]
    const fourthListing = parsed.listings[3]

    if (!firstListing || !secondListing || !thirdListing || !fourthListing) {
      throw new Error('Expected four listings in parsed output')
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
      tags: ['Alquilada', 'Apartamento  '],
      agency: {
        title: 'Altor Asesores',
        url: 'https://www.idealista.com/pro/altorasesores/',
        markup: 'listado::logo-agencia'
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

    expect(thirdListing).toMatchObject({
      id: '110081222',
      label: 'Piso en Calle Agencia, Madrid',
      price: {
        value: 300000,
        currency: 'EUR'
      },
      agency: {
        title: 'Agencia Top',
        url: 'https://www.idealista.com/pro/agencia-top/',
        markup: 'agency-highlight'
      }
    })

    expect(fourthListing).toMatchObject({
      id: '110081333',
      label: 'Piso en Calle Pro Link, Madrid',
      price: {
        value: 280000,
        currency: 'EUR'
      },
      agency: {
        title: 'Huspy',
        url: 'https://www.idealista.com/pro/huspy/',
        markup: 'listado::logo-agencia'
      }
    })
  })
})
