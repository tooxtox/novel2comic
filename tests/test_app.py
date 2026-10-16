"""Regression checks for the modular Flask backend; all writes use temporary files.

Run with: python -m unittest discover -s tests -v
"""

from contextlib import ExitStack
import importlib
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest import mock
from jinja2 import FileSystemLoader


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Snapshot of the original app.py contract (automatic HEAD/OPTIONS excluded).
ROUTES = {
    ('/static/<path:filename>', 'static', ('GET',)),
    ('/', 'home', ('GET',)),
    ('/tooxtox', 'landing', ('GET',)),
    ('/app', 'index', ('GET',)),
    ('/api/login', 'login', ('POST',)),
    ('/api/register', 'register', ('POST',)),
    ('/api/logout', 'logout', ('POST',)),
    ('/api/check-auth', 'check_auth', ('GET',)),
    ('/api/segment', 'segment_novel', ('POST',)),
    ('/api/save-config', 'save_config', ('POST',)),
    ('/api/load-config', 'load_config', ('GET',)),
    ('/api/test-llm', 'test_llm', ('POST',)),
    ('/api/test-image', 'test_image', ('POST',)),
    ('/api/generate-characters', 'generate_characters', ('POST',)),
    ('/api/generate-character-image', 'generate_character_image', ('POST',)),
    ('/api/generate-page', 'generate_page', ('POST',)),
    ('/api/reposition-bubbles', 'reposition_bubbles', ('POST',)),
    ('/api/work/start', 'work_start', ('POST',)),
    ('/api/work/save-state', 'work_save_state', ('POST',)),
    ('/api/history', 'history_list', ('GET',)),
    ('/api/history/<work_id>', 'history_detail', ('GET',)),
    ('/api/history/<work_id>/load', 'history_load', ('POST',)),
    ('/api/history/<work_id>', 'history_delete', ('DELETE',)),
    ('/api/history/<work_id>/rename', 'history_rename', ('POST',)),
    ('/api/history/<work_id>/visibility', 'history_visibility', ('POST',)),
    ('/api/discover', 'discover', ('GET',)),
    ('/api/public/work/<owner>/<work_id>', 'public_work_detail', ('GET',)),
    ('/api/public/work/<owner>/<work_id>/fork', 'public_work_fork', ('POST',)),
    ('/api/writing/save', 'writing_save', ('POST',)),
    ('/api/writings', 'writings_list', ('GET',)),
    ('/api/writing/<writing_id>', 'writing_detail', ('GET',)),
    ('/api/writing/<writing_id>/rename', 'writing_rename', ('POST',)),
    ('/api/writing/<writing_id>', 'writing_delete', ('DELETE',)),
    ('/api/generate-title', 'generate_title', ('POST',)),
    ('/api/plot-options', 'plot_options', ('POST',)),
    ('/api/continue-novel', 'continue_novel', ('POST',)),
    ('/api/polish-styles', 'polish_styles', ('POST',)),
    ('/api/polish-novel', 'polish_novel', ('POST',)),
    ('/api/work/rename-current', 'rename_current_work', ('POST',)),
    ('/api/clear-cache', 'clear_cache', ('POST',)),
    ('/api/download', 'download_image_proxy', ('POST',)),
    ('/api/comic-to-novel', 'comic_to_novel', ('POST',)),
    ('/api/results/<data_type>', 'get_results', ('GET',)),
    ('/api/sync/results', 'sync_results', ('POST',)),
}


class AppRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        stack = ExitStack()
        cls.addClassCleanup(stack.close)
        import_dir = stack.enter_context(tempfile.TemporaryDirectory())
        stack.enter_context(mock.patch.dict('os.environ', {
            'MANGA_SECRET_KEY': 'unittest-secret-key',
            'MANGA_ADMIN_USERNAME': 'test_admin',
            'MANGA_ADMIN_PASSWORD': 'unittest-admin-password',
            'CLOUDBASE_REPORT_PROGRESS_URL': '',
        }))
        # PyInstaller separates read-only resources from writable data at import.
        # This also prevents reading the project's .env before path patches apply.
        with mock.patch.multiple(sys, frozen=True, _MEIPASS=str(ROOT),
                                 executable=str(Path(import_dir) / 'test.exe'), create=True):
            cls.app = importlib.import_module('app').app
            cls.modules = [importlib.import_module('backend.' + name) for name in (
                'runtime', 'ai_client', 'storage', 'auth', 'rendering',
                'comic', 'works', 'writing', 'api',
            )]
        cls.app.config.update(TESTING=True)

    def setUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.data_dir = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        paths = {
            'BASE_DIR': self.data_dir,
            '_PERSIST_DIR': self.data_dir,
            'ENV_FILE': self.data_dir / '.env',
            'CONFIG_LOCAL_PATH': self.data_dir / 'config.local.json',
            'CONFIG_TEMPLATE_PATH': self.data_dir / 'config.json',
            'USERS_FILE': self.data_dir / 'users.json',
            'OUTPUT_DIR': self.data_dir / 'static' / 'output',
            'CACHE_DIR': self.data_dir / 'static' / 'cache',
            'RESULTS_DIR': self.data_dir / 'results',
            'USER_DATA_DIR': self.data_dir / 'static' / 'users',
        }
        for name in ('OUTPUT_DIR', 'CACHE_DIR', 'RESULTS_DIR', 'USER_DATA_DIR'):
            paths[name].mkdir(parents=True)
        for module in self.modules:
            for name, path in paths.items():
                if hasattr(module, name):
                    stack.enter_context(mock.patch.object(module, name, str(path)))
            if hasattr(module, '_visibility_cache'):
                module._visibility_cache.clear()
        stack.enter_context(mock.patch('requests.sessions.Session.request',
                                       side_effect=AssertionError('Network disabled in tests')))
        self.client = self.app.test_client()

    def login(self, client=None, username='alice'):
        client = client or self.client
        credentials = {'username': username, 'password': 'test-password'}
        response = client.post('/api/register', json={**credentials, 'confirm': 'test-password'})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        response = client.post('/api/login', json=credentials)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return client

    def mutate(self, path, data=None, method='POST', client=None):
        client = client or self.client
        with client.session_transaction() as session:
            token = session['_csrf_token']
        return client.open(path, method=method, json=data or {}, headers={'X-CSRF-Token': token})

    def test_route_contract(self):
        actual = {(rule.rule, rule.endpoint, tuple(sorted(rule.methods - {'HEAD', 'OPTIONS'})))
                  for rule in self.app.url_map.iter_rules()}
        self.assertEqual(actual, ROUTES)
        self.assertEqual(len(list(self.app.url_map.iter_rules())), 44)

    def test_pages_auth_and_csrf(self):
        for path in ('/', '/tooxtox', '/app'):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertIn(b'<html', response.data)
        self.assertIn(b'id="login-password"', self.client.get('/app').data)
        self.assertEqual(self.client.get('/api/history').status_code, 401)
        with self.client.session_transaction() as session:
            old_token = session['_csrf_token']
        self.login()
        with self.client.session_transaction() as session:
            self.assertNotEqual(session['_csrf_token'], old_token)
        self.assertEqual(self.client.get('/api/check-auth').json['username'], 'alice')
        self.assertNotIn(b'id="login-password"', self.client.get('/app').data)
        self.assertIn(b'name="csrf-token"', self.client.get('/app').data)
        for headers in ({}, {'X-CSRF-Token': 'wrong-token'}):
            response = self.client.post('/api/work/start', json={}, headers=headers)
            self.assertEqual(response.status_code, 403)
            self.assertTrue(response.json['csrf_failed'])
        self.assertEqual(self.mutate('/api/logout').status_code, 200)
        self.assertFalse(self.client.get('/api/check-auth').json['logged_in'])

    def test_config_persistence(self):
        self.login()
        self.assertEqual(self.client.get('/api/load-config').json, {})
        defaults = {'llm_model': 'bundled-model', 'llm_api_key': 'test-bundled-key'}
        template = self.data_dir / 'config.json'
        template.write_text(json.dumps(defaults), encoding='utf-8')
        self.assertEqual(self.client.get('/api/load-config').json, defaults)
        config = {'llm_model': 'test-model', 'image_model': 'test-image'}
        self.assertEqual(self.mutate('/api/save-config', config).status_code, 200)
        self.assertEqual(self.client.get('/api/load-config').json, config)
        self.assertEqual(json.loads((self.data_dir / 'config.local.json').read_text()), config)
        self.assertEqual(json.loads(template.read_text()), defaults)

    def test_android_templates_and_csrf(self):
        templates = ROOT / 'android' / 'app' / 'src' / 'main' / 'assets' / 'templates'
        with mock.patch.object(self.app.jinja_env, 'loader', FileSystemLoader(templates)):
            login_page = self.client.get('/').get_data(as_text=True)
            self.assertRegex(login_page, r'<meta name="csrf-token" content="[^"]+">')
            self.login()
            page = self.client.get('/app').get_data(as_text=True)
            token = re.search(r'<meta name="csrf-token" content="([^"]+)">', page)
            self.assertIsNotNone(token, 'Android page must supply the CSRF token')
            self.assertIn('/static/tailwind.css', page)
            self.assertNotIn('cdn.tailwindcss.com', page)
            for headers in ({}, {'X-CSRF-Token': 'wrong-token'}):
                response = self.client.post('/api/save-config', json={}, headers=headers)
                self.assertEqual(response.status_code, 403)
                self.assertTrue(response.json['csrf_failed'])
            config = {'llm_model': 'android-test'}
            response = self.client.post('/api/save-config', json=config,
                                        headers={'X-CSRF-Token': token.group(1)})
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            self.assertEqual(self.client.get('/api/load-config').json, config)

    def test_work_state_and_history(self):
        self.login()
        created = self.mutate('/api/work/start', {'title': '测试漫画'})
        self.assertEqual(created.status_code, 200)
        work_id = created.json['work_id']
        state = {'novel_text': '一段小说',
                 'segments': {'pages': [{'page_number': 1, 'segments': [{'dialogue': '你好'}]}]},
                 'characters': [{'name': '小明'}]}
        self.assertEqual(self.mutate('/api/work/save-state', state).status_code, 200)
        history = self.client.get('/api/history').json['works']
        self.assertEqual([work['work_id'] for work in history], [work_id])
        detail = self.client.get('/api/history/' + work_id).json
        self.assertEqual(detail['meta']['title'], '测试漫画')
        self.assertFalse(detail['meta']['is_public'])
        self.assertEqual(detail['state']['novel_text'], state['novel_text'])
        self.assertEqual(detail['state']['_meta']['segment_count'], 1)
        loaded = self.mutate('/api/history/' + work_id + '/load').json
        self.assertEqual(loaded['state']['characters'], state['characters'])
        self.assertEqual(self.mutate('/api/history/' + work_id, method='DELETE').status_code, 200)
        self.assertEqual(self.client.get('/api/history').json['works'], [])
        self.assertEqual(self.client.get('/api/history/' + work_id).status_code, 404)

    def test_static_privacy_and_traversal(self):
        self.login()
        work_id = self.mutate('/api/work/start', {'title': '私密作品'}).json['work_id']
        work_dir = self.data_dir / 'static' / 'users' / 'alice' / 'works' / work_id
        (work_dir / 'images' / 'test.png').write_bytes(b'private-image')
        (self.data_dir / '.env').write_text('TOP_SECRET=hidden', encoding='utf-8')
        image_url = f'/static/users/alice/works/{work_id}/images/test.png'
        anonymous = self.app.test_client()
        other = self.login(self.app.test_client(), 'bob')
        with self.client.get(image_url) as response:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data, b'private-image')
        for client in (anonymous, other):
            self.assertEqual(client.get(image_url).status_code, 404)
        self.assertEqual(other.get('/api/history/' + work_id).status_code, 404)
        for path in ('/static/../.env', '/static/%2e%2e/.env',
                     '/static/users/alice/history.json',
                     f'/static/users/alice/works/{work_id}/meta.json',
                     '/static/..%5c.env'):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.get('/api/history/not-a-uuid').status_code, 400)
        self.assertEqual(self.mutate('/api/history/' + work_id + '/visibility',
                                     {'is_public': True}).status_code, 200)
        with anonymous.get(image_url) as response:
            self.assertEqual(response.status_code, 200)
        self.assertEqual(self.mutate('/api/history/' + work_id + '/visibility',
                                     {'is_public': False}).status_code, 200)
        self.assertEqual(anonymous.get(image_url).status_code, 404)

    def test_writing_save_read_update_delete(self):
        self.login()
        saved = self.mutate('/api/writing/save', {'title': '测试写作', 'content': '第一段'})
        self.assertEqual(saved.status_code, 200)
        writing_id = saved.json['writing_id']
        path = '/api/writing/' + writing_id
        self.assertEqual(self.client.get(path).json['data']['content'], '第一段')
        self.assertEqual(self.client.get('/api/writings').json['works'][0]['writing_id'], writing_id)
        updated = self.mutate('/api/writing/save', {'writing_id': writing_id, 'content': '更新内容'})
        self.assertEqual(updated.json['writing_id'], writing_id)
        self.assertEqual(self.client.get(path).json['data']['content'], '更新内容')
        self.assertEqual(self.mutate(path, method='DELETE').status_code, 200)
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.get('/api/writings').json['works'], [])

    def test_segment_with_mock_ai_persists_session_results(self):
        self.login()
        parsed = {'pages': [{'page_number': 9, 'segments': [{
            'segment_number': 8, 'scene_description': '少年走入房间', 'dialogue': '你好',
        }]}], 'characters': [{'name': '少年', 'description': '黑发少年'}]}
        api_response = mock.Mock(status_code=200, headers={}, text='mock AI response')
        api_response.json.return_value = {'choices': [{'message': {
            'content': '```json\n' + json.dumps(parsed, ensure_ascii=False) + '\n```',
        }}]}
        with ExitStack() as stack:
            calls = [stack.enter_context(mock.patch.object(module, '_api_request',
                     return_value=api_response)) for module in self.modules
                     if hasattr(module, '_api_request')]
            response = self.mutate('/api/segment', {'text': '少年说：“你好。”',
                                                   'api_url': 'https://example.invalid/llm',
                                                   'comic_mode': 'color'})
            self.assertEqual(sum(call.call_count for call in calls), 1)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        data = response.json['data']
        segment = data['pages'][0]['segments'][0]
        self.assertEqual(data['pages'][0]['page_number'], 1)
        self.assertEqual(segment['segment_number'], 1)
        self.assertEqual(segment['dialogue_type'], 'dialogue')
        self.assertIn('full color', segment['style_prompt'])
        self.assertEqual(self.client.get('/api/results/segments').json['data'], data)
        self.assertEqual(self.client.get('/api/results/characters').json['data']['characters'],
                         response.json['characters'])
        self.assertEqual(len(list((self.data_dir / 'results').glob('*.json'))), 2)


if __name__ == '__main__':
    unittest.main()
