# Earth asset provenance

Retrieved 2026-09-30. All runtime assets are local; there is no runtime CDN or map service.

- `earth-july-2004.jpg`: NASA Earth Observatory, Blue Marble: Next Generation, July 2004 global base map. Source: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x5400x2700.jpg
- Source landing page: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/
- Modification: Lanczos resize from 5400×2700 to 2048×1024; JPEG quality 84, optimized. No invented terrain, city lights, weather, logos, or identifiable people.
- `earth-still.webp`: 640×640 transparent orthographic projection of the same map, 23.4° tilt, fixed artistic directional shading and a subtle rim. It contains **no member dots**. Generated with Pillow using `scripts/prepare-earth-assets.py`.
- NASA usage guidance checked: https://science.nasa.gov/earth/faq/ and https://www.nasa.gov/nasa-brand-center/images-and-media/ . This NASA-produced base map has no identified third-party copyright restriction. NASA's guidelines permit factual use with acknowledgment and no implied endorsement. The in-product credit links to `docs/globe/credits.html`; no NASA logo is used.

# Broad-region catalog

- Natural Earth v5.1.2, public domain: https://www.naturalearthdata.com/about/terms-of-use/
- https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_map_units.geojson
- https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson
- https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_land.geojson
- https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_lakes.geojson
- ISO 3166 country/territory names and keys: pycountry 26.2.16 (LGPL-2.1-only package; this repository contains only the generated factual catalog, not the package). https://github.com/pycountry/pycountry
- `scripts/generate-globe-catalog.py` uses the maintained upstream catalog to check all 249 keys. Map units keep overseas territories separate; the countries layer fills UM. No custom territorial claims or city catalog.
- Up to 16 deterministic points per region are sampled inside its administrative polygons intersected with physical land, minus lake polygons. Rounded coordinates are checked again against that land area. No browser-side jitter. These are public map anchors, not coordinates supplied by members. Very small territories can be subpixel at this scale.
- Refresh from the cited upstream datasets when ISO/Natural Earth change; review renamed or retired keys and migrate existing memberships deliberately, without silently changing members' choices. Large-country subdivisions are deferred; the country-wide selection is explicit.
