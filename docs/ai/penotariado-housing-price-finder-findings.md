# Penotariado Housing Price Finder — Findings

Date: 2026-02-19

## Executive summary

- The map visualization is rendered on a canvas (`div.esri-view-root`) inside an iframe (`https://penotariado.com/mapa/?locale=en`).
- The data is scrapable because business values are fetched from ArcGIS FeatureServer endpoints (JSON/PBF), not only drawn pixels.
- Search behavior (for example `Madrid`) is implemented through ArcGIS `query` requests (`fullText`, `where`, and layer-specific filters).

## Architecture observed

1. Main shell page: `https://penotariado.com/inmobiliario/.../housing-price-finder...`
2. Embedded map app iframe: `https://penotariado.com/mapa/?locale=en`
3. ArcGIS Experience Builder assets loaded from: `https://penotariado.com/mapa/cdn/52/...`
4. ArcGIS runtime/data endpoints under:
   - `https://www.arcgis.com/sharing/rest/...`
   - `https://services-eu1.arcgis.com/UpPGybwp9RK4YtZj/arcgis/rest/services/...`

## Key data endpoints

### KPI layer family (price/m² and related)

- `agol_precio_m2/FeatureServer`
- `agol_precio_medio/FeatureServer`
- `agol_compraventas/FeatureServer`
- `agol_superficie_media/FeatureServer`

### Typical filters

- Base filter:
  - `(tipo_construccion_id = 99) AND (clase_finca_urbana_id = 99)`
- Search-specific examples observed for `Madrid`:
  - CCAA: `(name_ccaa2 = 'Madrid') OR (name_ccaa = 'Madrid')`
  - Province: `(name_prov2 = 'Madrid') OR (name_prov = 'Madrid')`
  - Municipality: `(name_muni2 = 'Madrid') OR (name_muni = 'Madrid')`
  - Postal code layer: `(cp = 'Madrid')` and prefix probe `(cp LIKE 'Madrid%')`
  - Selected province refinement: `cod_prov = '28'`

## Why this is scrapable

- The canvas is only the rendering surface.
- Values such as `€/m²` and search results are returned by HTTP requests with structured payloads.
- This enables extraction from network/API level rather than OCR/pixel analysis.

## Recommended extraction strategy

1. Keep a browser-based inspector for reverse engineering and regression checks.
2. For bulk extraction, query ArcGIS endpoints directly using the discovered filters.
3. Store artifacts (HTML, screenshots, probe responses) for reproducibility.

## New CLI action implemented

A new action was added in `packages/scraper/src/actions/map-inspect.ts` and wired in `packages/scraper/src/cli.ts`.

### Command

```bash
pnpm --filter @workspace/scraper cli map-inspect \
  --url="https://penotariado.com/inmobiliario/en/housing-price-finder?constructionType=99&propertyType=99&locationType=PA&kpi=pricePerSqm&locationCode=null&withStatistics=true" \
  --search="Madrid" \
  --outputDir="./tmp/map-inspect" \
  --pretty
```

### What it generates

- Root page HTML + screenshot
- Map iframe HTML + screenshot (if iframe is detected)
- ArcGIS probe JSON results
- Markdown report at `tmp/map-inspect/report.md`

## Notes

- Endpoint contracts may evolve over time (field names/layers), so keep probes versioned.
- Respect target website terms and applicable legal/compliance requirements in your deployment context.
