import importlib.util
import pathlib
import unittest

PATH=pathlib.Path(__file__).resolve().parents[1]/"scripts"/"build_xml_audio_archive.py"
spec=importlib.util.spec_from_file_location("build_xml_audio_archive",PATH)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class AudioXmlBackfillTests(unittest.TestCase):
    def test_opening_first_tuesday_in_october(self):
        cases={
            "2024-09-30":"20231",
            "2024-10-01":"20241",
            "2025-10-06":"20241",
            "2025-10-07":"20251",
            "2026-09-01":"20251",
            "2026-10-01":"20251",
            "2026-10-05":"20251",
            "2026-10-06":"20261",
            "2026-10-23":"20261",
        }
        for date,session in cases.items():
            with self.subTest(date=date):
                options=mod.session_candidates(date)
                self.assertEqual(options[0],session)
                self.assertEqual(options[1],session[:-1]+"2")

    def test_primary_rss_entries_are_preferred_and_duplicates_removed(self):
        entries=[
            {"date":"2026-10-08","meeting_no":3,"title":"Møde i salen (m. tegnsprog): 8. oktober","mp3_url":"signed"},
            {"date":"2026-10-08","meeting_no":3,"title":"Møde i salen: 8. oktober","mp3_url":"normal"},
            {"date":"2026-10-09","meeting_no":4,"title":"Møde i salen: 9. oktober","mp3_url":"next"},
            {"date":"2026-10-08","meeting_no":3,"title":"Møde i salen: 8. oktober","mp3_url":"normal"},
        ]
        results=list(mod.unique_primary_audio(entries))
        self.assertEqual(len(results),2)
        self.assertEqual(results[0]["mp3_url"],"next")
        self.assertEqual(results[1]["mp3_url"],"normal")

    def test_direct_mp3_url_pattern_only(self):
        valid="https://cdnapi.kaltura.com/p/2158211/sp/0/playManifest/entryId/1_g2xq1234/protocol/http/flavorParamIds/0/format/url/08-11-2024_09-00_salen.mp3"
        self.assertIsNotNone(mod.VALID.fullmatch(valid))
        self.assertIsNone(mod.VALID.fullmatch(valid.replace(".mp3",".mp4")))
        self.assertIsNone(mod.VALID.fullmatch(valid.replace("cdnapi.kaltura.com","malicious.test")))


if __name__=="__main__":
    unittest.main()
