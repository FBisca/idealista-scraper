export { UlixeeWebEngine } from "./web-engine/ulixee-engine.js";
export {
  ContentParserPlugin,
  WebContentParser,
  type ParseContext,
  type WebContent
} from "./web-engine/types.js";
export {
  resolveParserWithPlugins,
  type ResolveParserResult
} from "./web-engine/parser-resolver.js";
export {
  IdealistaListParserPlugin,
  type IdealistaAgencyInfo,
  type IdealistaAveragePricePerSquareMeter,
  type IdealistaListing,
  type IdealistaListingDetails,
  type IdealistaPaginationInfo,
  type IdealistaPriceInfo,
  type IdealistaListParseResult
} from "./plugins/idealista-list-parser.js";
export {
  IdealistaDetailParserPlugin,
  type IdealistaDetailAdvertiser,
  type IdealistaDetailBasicFeatures,
  type IdealistaDetailBuildingFeatures,
  type IdealistaDetailEnergyCertificate,
  type IdealistaDetailLocation,
  type IdealistaDetailParseResult,
  type IdealistaDetailPricing
} from "./plugins/idealista-detail-parser.js";
export type { SearchResult } from "./web-engine/search/types.js";
