# Earth asset provenance

Retrieved 2026-09-30. All runtime assets are local; there is no runtime CDN or map service.

- `earth-july-2004.jpg`: NASA Earth Observatory, Blue Marble: Next Generation, July 2004 global base map. Source: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x5400x2700.jpg
- Source landing page: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/
- Modification: Lanczos resize from 5400×2700 to 2048×1024; JPEG quality 84, optimized. No invented terrain, city lights, weather, logos, or identifiable people.
- `earth-still.webp`: 640×640 transparent orthographic projection of the same map, 23.4° tilt, fixed artistic directional shading and a subtle rim. It contains **no member dots**. Generated with Pillow using `scripts/prepare-earth-assets.py`. PR #106 brightens the daylight/fill to match the live Earth; `--fallback-only` leaves the original texture unchanged.
- NASA usage guidance checked: https://science.nasa.gov/earth/faq/ and https://www.nasa.gov/nasa-brand-center/images-and-media/ . This NASA-produced base map has no identified third-party copyright restriction. NASA's guidelines permit factual use with acknowledgment and no implied endorsement. The in-product credit links to `docs/globe/credits.html`; no NASA logo is used.

# Broad-region catalog

- Natural Earth v5.1.2, public domain: https://www.naturalearthdata.com/about/terms-of-use/
- https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_map_units.geojson
- https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson
- https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_land.geojson
- https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_lakes.geojson
- ISO 3166 country/territory names and keys: pycountry 26.2.16 (LGPL-2.1-only package; this repository contains only the generated factual catalog, not the package). https://github.com/pycountry/pycountry
- `scripts/generate-globe-catalog.py` uses the maintained upstream catalog to check all 249 keys. Map units keep overseas territories separate; the countries layer fills UM. No custom territorial claims.
- Up to 16 deterministic points per region are sampled inside its administrative polygons intersected with physical land, minus lake polygons. Rounded coordinates are checked again against that land area. No browser-side jitter. These are public map anchors, not coordinates supplied by members. Very small territories can be subpixel at this scale.
- Refresh from the cited upstream datasets when ISO/Natural Earth change; review renamed or retired keys and migrate existing memberships deliberately, without silently changing members' choices. Large-country subdivisions are deferred; the country-wide selection is explicit.

# Optional city catalog — PR #106

- Natural Earth v5.1.2 1:10m populated places (public domain), retrieved 2026-10-01: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_populated_places.geojson
- Keep only entries with a supported ISO country/territory. Keys use Natural Earth's stable `NE_ID` (`ne-…`), English/display name, admin name and public city anchor rounded to six decimals. 7,330 supported places; entries lacking a supported ISO key are excluded. No inferred member location.
- Natural Earth omits Springdale, Arkansas and Paris, Texas. Two documented supplements use the U.S. Census Bureau 2025 national places Gazetteer (public factual data): https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip . Source GEOIDs: `0566080`, `4855080`; coordinates are `INTPTLAT`/`INTPTLONG`, public place representative points. The reviewed records are in `city-supplements.json`; keys are `us-census-<GEOID>`.
- 7,332 total choices. This is a representative catalog, not every town. If a city is missing, country-only participation is available. These are public cartographic positions, not personal/GPS coordinates.
- Reproduce static JS and key/country SQL seed: `python scripts/generate-globe-catalog.py --cities POPULATED_PLACES.geojson CITY_SEED.sql`. The SQL seed belongs only in a new forward migration. Do not regenerate/replay a historical migration or silently remove/rename membership keys.
- `shared/globe-cities.js` loads only when the dialog opens or a city group needs rendering, never as a required worker-install asset. The database stores a controlled key/country whitelist; labels/coordinates are owned static code.
