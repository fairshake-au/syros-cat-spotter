import React from 'react';
import { UrlTile } from 'react-native-maps';
import {
  LOCAL_TILE_TEMPLATE,
  MAX_TILE_ZOOM,
  ONLINE_TILE_TEMPLATE,
  useOfflineTiles,
} from '@/lib/offlineTiles';

/**
 * OpenStreetMap tile layer that automatically switches to the preloaded
 * offline Syros tiles once they are downloaded. Native only — the web
 * AppMap fallback uses an OSM iframe instead.
 */
export function OsmTiles() {
  const { ready } = useOfflineTiles();
  return (
    <UrlTile
      urlTemplate={ready ? LOCAL_TILE_TEMPLATE : ONLINE_TILE_TEMPLATE}
      maximumZ={MAX_TILE_ZOOM}
      shouldReplaceMapContent
      zIndex={-1}
    />
  );
}
