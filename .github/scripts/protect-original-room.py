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

from PIL import Image, ImageDraw, ImageChops

def make_edit_mask(original_path: str, manifest_path: str, output_path: str) -> None:
    """Prepare the first-image edit mask for OpenAI.

    Alpha 0 = editable mural footprint. Alpha 255 = original room protected.
    The post-generation compositor remains authoritative: the API mask is
    guidance to the model and does NOT replace deterministic clipping.
    """
    with open(manifest_path, encoding="utf-8") as handle:
        manifest = json.load(handle)
    points = manifest.get("placement", {}).get("fresco_quad_normalized")
    if not isinstance(points, list) or len(points) != 4:
        raise ValueError("Missing authenticated fresco geometry")
    with Image.open(original_path) as photo:
        width,height=photo.size
    if width<100 or height<100:
        raise ValueError("Unexpected image size")
    corners=[]
    for item in points:
        if (not isinstance(item,list) or len(item)!=2 or
            any(not isinstance(v,(int,float)) or not math.isfinite(v) or
                not -20<=v<=20 for v in item)):
            raise ValueError("Invalid fresco quadrilateral coordinates")
        corners.append((round(item[0]*width),round(item[1]*height)))
    # Source photo has its own camera coordinate system. The user may place
    # some vertices outside its visible area: PIL clips the polygon safely.
    image = Image.new("RGBA",(width,height),(0,0,0,255))
    draw=ImageDraw.Draw(image)
    draw.polygon(corners,fill=(0,0,0,0))
    strokes=manifest.get("placement",{}).get("occlusion_strokes",[])
    if not isinstance(strokes,list) or len(strokes)>64:
        raise ValueError("Invalid foreground protection data")
    total=0
    for stroke in strokes:
        if not isinstance(stroke,dict):
            raise ValueError("Invalid foreground stroke")
        radius=stroke.get("radius");points=stroke.get("points")
        if (not isinstance(radius,(int,float)) or not math.isfinite(radius) or
            not .00025<=radius<=.15 or not isinstance(points,list) or
            not 1<=len(points)<=128):
            raise ValueError("Invalid foreground stroke")
        total+=len(points)
        if total>3000:
            raise ValueError("Too many foreground points")
        coords=[]
        for p in points:
            if (not isinstance(p,list) or len(p)!=2 or any(
                not isinstance(v,(int,float)) or not math.isfinite(v) or not 0<=v<=1
                for v in p)):
                raise ValueError("Invalid foreground coordinates")
            coords.append((round(p[0]*width),round(p[1]*height)))
        radius_px=max(1,round(radius*width))
        if len(coords)>1:
            draw.line(coords,fill=(0,0,0,255),width=radius_px*2+1,joint="curve")
        for x,y in coords:
            draw.ellipse((x-radius_px,y-radius_px,x+radius_px,y+radius_px),
                         fill=(0,0,0,255))
    image.save(output_path,"PNG",optimize=True)
    if Path(output_path).stat().st_size>4*1024*1024:
        raise ValueError("OpenAI editing mask exceeds 4MB")


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
        # The user marks REAL furniture/objects on the original, including
        # portions overlapping the mural. Protect those original pixels here.
        strokes = manifest.get("placement", {}).get("occlusion_strokes", [])
        if not isinstance(strokes, list) or len(strokes) > 64:
            raise ValueError("Invalid foreground protection data")
        if strokes:
            foreground = Image.new("L", proposal.size, 0)
            pen = ImageDraw.Draw(foreground)
            total = 0
            for stroke in strokes:
                if not isinstance(stroke, dict):
                    raise ValueError("Invalid foreground stroke")
                radius = stroke.get("radius")
                points = stroke.get("points")
                if (not isinstance(radius, (float, int)) or not math.isfinite(radius) or
                    not .00025 <= radius <= .15 or not isinstance(points, list) or
                    not 1 <= len(points) <= 128):
                    raise ValueError("Invalid foreground stroke")
                total += len(points)
                if total > 3000:
                    raise ValueError("Too many foreground points")
                coords=[]
                for p in points:
                    if (not isinstance(p, list) or len(p)!=2 or
                        any(not isinstance(v,(int,float)) or not math.isfinite(v) or not 0<=v<=1 for v in p)):
                        raise ValueError("Invalid foreground coordinates")
                    coords.append((round(p[0]*w),round(p[1]*h)))
                pixel_radius=max(1,round(radius*w))
                if len(coords)>1:
                    pen.line(coords, fill=255, width=pixel_radius*2+1, joint="curve")
                for x,y in coords:
                    pen.ellipse((x-pixel_radius,y-pixel_radius,x+pixel_radius,y+pixel_radius),fill=255)
            mask = ImageChops.subtract(mask, foreground)
        result = Image.composite(proposed, room, mask)
        result.save(output_path, "PNG", optimize=True)
        if Path(output_path).stat().st_size > 12*1024*1024:
            raise ValueError("Composited PNG exceeds callback size limit")

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--original", required=True)
    p.add_argument("--generated")
    p.add_argument("--manifest", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--make-edit-mask", action="store_true")
    args = p.parse_args()
    if args.make_edit_mask:
        make_edit_mask(args.original, args.manifest, args.output)
    elif args.generated:
        composite(args.original, args.generated, args.manifest, args.output)
    else:
        p.error("--generated required unless --make-edit-mask is used")

if __name__ == "__main__":
    main()
