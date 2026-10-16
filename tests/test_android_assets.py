"""Android asset synchronization must refresh HTML and preserve offline references."""

from pathlib import Path
import importlib.util
import json
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import build_assets
import localize_assets


class AndroidAssetSyncTests(unittest.TestCase):
    def test_embed_current_config(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / 'app.py').write_text('# test entry point\n', encoding='utf-8')
            template = {'llm_model': 'template-model'}
            legacy = {'llm_model': 'legacy-model', 'llm_api_key': 'test-legacy-key'}
            current = {'llm_model': 'current-model', 'llm_api_key': 'test-key',
                       'img_api_key': 'test-image-key', 'bubble_render_mode': 'overlay'}
            (project / 'config.example.json').write_text(json.dumps(template), encoding='utf-8')
            (project / 'config.json').write_text(json.dumps(legacy), encoding='utf-8')
            (project / 'config.local.json').write_text(json.dumps(current), encoding='utf-8')
            assets = project / 'android' / 'app' / 'src' / 'main' / 'assets'
            with mock.patch.multiple(build_assets, PROJECT_ROOT=project, ASSETS=assets,
                                     PYTHON_DIR=assets.parent / 'python'), \
                    mock.patch.object(localize_assets, 'TEMPLATES', assets / 'templates'):
                build_assets.sync()
                self.assertEqual(json.loads((assets / 'config.json').read_text()), template)
                build_assets.sync(embed_config=True)
                self.assertEqual(json.loads((assets / 'config.json').read_text()), current)
                self.assertIn('config.json', (assets / 'asset_manifest.txt').read_text().splitlines())
                (project / 'config.local.json').unlink()
                build_assets.sync(embed_config=True)
                self.assertEqual(json.loads((assets / 'config.json').read_text()), legacy)

    def test_android_config_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            files = Path(directory) / 'files'
            files.mkdir()
            resources = Path(directory) / 'res'
            spec = importlib.util.spec_from_file_location('android_runtime_test', ROOT / 'backend/runtime.py')
            runtime = importlib.util.module_from_spec(spec)
            with mock.patch.object(sys, 'getandroidapilevel', lambda: 34, create=True), \
                    mock.patch.dict('os.environ', {
                        'T2C_RESOURCE_DIR': str(resources), 'T2C_FILES_DIR': str(files),
                        'MANGA_SECRET_KEY': 'test-secret', 'MANGA_ADMIN_USERNAME': 'test-admin',
                        'MANGA_ADMIN_PASSWORD': 'test-password',
                    }):
                spec.loader.exec_module(runtime)
            self.assertEqual(Path(runtime.CONFIG_TEMPLATE_PATH), resources / 'config.json')
            self.assertEqual(Path(runtime.CONFIG_LOCAL_PATH), files / 'config.local.json')

    def test_sync_refreshes_localized_templates(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            source = project / 'templates'
            source.mkdir()
            (project / 'app.py').write_text('# test entry point\n', encoding='utf-8')
            assets = project / 'android' / 'app' / 'src' / 'main' / 'assets'
            target = assets / 'templates'
            target.mkdir(parents=True)
            for name in ('index.html', 'login.html'):
                (source / name).write_text((ROOT / 'templates' / name).read_text(encoding='utf-8'),
                                          encoding='utf-8')
                (target / name).write_text('<link href="/static/tailwind.css">stale template',
                                          encoding='utf-8')
            with mock.patch.multiple(build_assets, PROJECT_ROOT=project, ASSETS=assets,
                                     PYTHON_DIR=assets.parent / 'python'), \
                    mock.patch.object(localize_assets, 'TEMPLATES', target):
                build_assets.sync()
                for name in ('index.html', 'login.html'):
                    html = (target / name).read_text(encoding='utf-8')
                    self.assertIn('<meta name="csrf-token" content="{{ csrf_token() }}">', html)
                    self.assertIn('/static/tailwind.css', html)
                    self.assertIn('/static/fonts/noto-sans-sc.css', html)
                    self.assertNotIn('cdn.tailwindcss.com', html)
                    self.assertNotIn('stale template', html)
                with (source / 'index.html').open('a', encoding='utf-8') as stream:
                    stream.write('\n<!-- latest template -->\n')
                build_assets.sync()
                html = (target / 'index.html').read_text(encoding='utf-8')
                self.assertIn('<!-- latest template -->', html)
                self.assertIn('/static/tailwind.css', html)
                self.assertNotIn('cdn.tailwindcss.com', html)


if __name__ == '__main__':
    unittest.main()
