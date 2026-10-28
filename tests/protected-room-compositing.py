#!/usr/bin/env python3
"""Offline regression checks for photo-preserving final composition."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

SOURCE = Path(__file__).resolve().parents[1] / ".github/scripts/protect-original-room.py"
spec = importlib.util.spec_from_file_location("protected_mural", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProtectedCompositionTests(unittest.TestCase):
    def test_original_bed_and_rug_untouched_outside_mural(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            original = Image.new("RGB", (640, 480), (226, 220, 208))
            draw = ImageDraw.Draw(original)
            # Bedroom props, deliberately outside the wall-artwork footprint.
            draw.rectangle((110, 300, 470, 410), fill=(120, 100, 80))  # bed
            draw.rectangle((70, 412, 570, 470), fill=(70, 44, 24))     # rug
            original.save(root/"room.jpg", quality=95)
            proposal = Image.new("RGB", (640, 480), (250, 20, 10))
            proposal.save(root/"proposal.png")
            manifest = {"placement": {"fresco_quad_normalized":
                [[.48, .10], [.82, .10], [.82, .56], [.48, .56]]}}
            (root/"manifest.json").write_text(json.dumps(manifest), encoding="utf8")
            module.composite(str(root/"room.jpg"), str(root/"proposal.png"),
                             str(root/"manifest.json"), str(root/"result.png"))
            with Image.open(root/"room.jpg") as source, Image.open(root/"result.png") as result:
                self.assertEqual(result.size, (640, 480))
                self.assertEqual(result.getpixel((200, 350)), source.getpixel((200, 350)), "Bed cannot disappear")
                self.assertEqual(result.getpixel((300, 440)), source.getpixel((300, 440)), "Rug cannot disappear")
                self.assertEqual(result.getpixel((40, 40)), source.getpixel((40, 40)), "Untouched room matches")
                self.assertEqual(result.getpixel((400, 180)), (250,20,10), "Mural interior remains AI-rendered")

    def test_reject_missing_quad_and_bad_camera_ratio(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            Image.new("RGB",(640,480),"white").save(root/"original.jpg")
            Image.new("RGB",(640,480),"blue").save(root/"proposal.png")
            (root/"manifest.json").write_text("{}",encoding="utf8")
            with self.assertRaisesRegex(ValueError, "Missing authenticated fresco geometry"):
                module.composite(str(root/"original.jpg"),str(root/"proposal.png"),
                    str(root/"manifest.json"),str(root/"out.png"))
            (root/"manifest.json").write_text(json.dumps({"placement":{"fresco_quad_normalized":
                [[.2,.2],[.8,.2],[.8,.8],[.2,.8]]}}),encoding="utf8")
            Image.new("RGB",(640,360),"blue").save(root/"proposal.png")
            with self.assertRaisesRegex(ValueError, "camera aspect ratio"):
                module.composite(str(root/"original.jpg"),str(root/"proposal.png"),
                    str(root/"manifest.json"),str(root/"out.png"))


if __name__=="__main__":
    unittest.main()
