import React, { useMemo, useRef, useState } from 'react';
import { TileLayer } from 'react-leaflet';
import type L from 'leaflet';
import {
  MAP_TILE_CONFIG,
  MapTileConfig,
  TileFallbackController,
  getTileAttribution,
  getTileUrl,
  isCartoUrl,
  isOsmStandardUrl,
} from '../constants/mapTiles';

export interface ResilientTileLayerProps {
  darkMode: boolean;
  config?: MapTileConfig;
  onFallbackChange?: (isFallback: boolean) => void;
}

function sampleTileHasTransparency(img: HTMLImageElement): boolean {
  try {
    if (!img || !img.naturalWidth || !img.naturalHeight) return false;
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data;
    let transparentCount = 0;
    const totalPixels = 16 * 16;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) {
        transparentCount++;
      }
    }
    return transparentCount / totalPixels > 0.5;
  } catch {
    return false;
  }
}

export const ResilientTileLayer: React.FC<ResilientTileLayerProps> = ({
  darkMode,
  config = MAP_TILE_CONFIG,
  onFallbackChange,
}) => {
  const [usingFallback, setUsingFallback] = useState(false);
  const controllerRef = useRef<TileFallbackController>(new TileFallbackController());

  const activeUrl = getTileUrl(darkMode, config, usingFallback);
  const activeAttribution = getTileAttribution(darkMode, config, usingFallback);
  const activeIsCarto = !usingFallback && isCartoUrl(activeUrl);
  const activeIsOsm = usingFallback || isOsmStandardUrl(activeUrl);

  const eventHandlers = useMemo<L.LeafletEventHandlerFnMap>(() => {
    if (activeIsOsm) {
      return {};
    }

    return {
      tileerror: () => {
        const tripped = controllerRef.current.recordTileError();
        if (tripped) {
          setUsingFallback(true);
          onFallbackChange?.(true);
        }
      },
      tileload: (e: L.TileEvent) => {
        const img = e.tile;
        const src = img?.getAttribute('src') || img?.src || '';
        const naturalWidth = img?.naturalWidth;
        const naturalHeight = img?.naturalHeight;
        const hasTransparentPixels =
          activeIsCarto && img ? sampleTileHasTransparency(img) : false;

        const tripped = controllerRef.current.recordTileLoad({
          src,
          naturalWidth,
          naturalHeight,
          hasTransparentPixels,
        });
        if (tripped) {
          setUsingFallback(true);
          onFallbackChange?.(true);
        }
      },
    };
  }, [activeIsCarto, activeIsOsm, onFallbackChange]);

  return (
    <TileLayer
      key={usingFallback ? 'osm-fallback' : darkMode ? 'primary-dark' : 'primary-light'}
      url={activeUrl}
      attribution={activeAttribution}
      maxNativeZoom={config.maxNativeZoom}
      maxZoom={config.maxZoom}
      detectRetina={config.detectRetina}
      tileSize={config.tileSize}
      keepBuffer={config.keepBuffer}
      crossOrigin={activeIsCarto ? 'anonymous' : undefined}
      eventHandlers={eventHandlers}
    />
  );
};
