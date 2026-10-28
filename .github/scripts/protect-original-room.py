#!/usr/bin/env python3
"""Keep ORIGINAL ROOM unchanged outside the exact wall fresco quadrilateral.

Only the interior of the four-corner mural may come from generated image.
This is a hard safeguard against AI adding or removing objects elsewhere,
not a solution for foreground-object occlusion *inside* the mural footprint.
"""
import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

def composite(original_path: str, generated_path: str, manifest_path: str, output_path: str) -> None:
    with open(manifest_path, encoding="utf-8") as handle:
        manifest = json.load(handle)
    points = manifest.get("placement", {}).get("fresco_quad_normalized")
    if not isinstance(points, list) or len(points) != 4:
        raise ValueError("Missing authenticated fresco geometry")
    quad = []
    for point in points:
        if (not isinstance(point, list) or len(point) != 2 or
            any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in point)):
            raise ValueError("Invalid fresco quadrilateral coordinates")
        quad.append(point)
    with Image.open(original_path) as photo, Image.open(generated_path) as proposal:
        if photo.width < 100 or photo.height < 100 or proposal.width < 100 or proposal.height < 100:
            raise ValueError("Unexpected image size")
        if abs(photo.width/photo.height-proposal.width/proposal.height) > .035:
            raise ValueError("Generated image changed the original camera aspect ratio")
        room = photo.convert("RGB").resize(proposal.size, Image.Resampling.LANCZOS)
        proposed = proposal.convert("RGB")
        mask = Image.new("L", proposal.size, 0)
        drawing = ImageDraw.Draw(mask)
        w, h = proposal.size
        polygon = [(round(x*w), round(y*h)) for x, y in quad]
        # The four vertices are in source-camera coordinates; no artistic
        # extrapolation outside the requested footprint is permitted.
        drawing.polygon(polygon, fill=255)
        result = Image.composite(proposed, room, mask)
        result.save(output_path, "PNG", optimize=True)
        if Path(output_path).stat().st_size > 12*1024*1024:
            raise ValueError("Composited PNG exceeds callback size limit")

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--original", required=True)
    p.add_argument("--generated", required=True)
    p.add_argument("--manifest", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()
    composite(args.original, args.generated, args.manifest, args.output)

if __name__ == "__main__":
    main()
