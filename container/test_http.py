"""Verify the built nginx container over HTTP, including legacy browser fallbacks."""
import gzip, hashlib, json, urllib.request, urllib.error

base='http://127.0.0.1:8080/'
def get(name, headers=None):
    return urllib.request.urlopen(urllib.request.Request(base+name, headers=headers or {}), timeout=15)
with get('health') as response: assert response.read()==b'ok'
with get('index.html') as response:
    assert response.headers['Cache-Control']=='no-cache'
    assert b'FrogRoadDelivery.prepare' in response.read()
with get('build.json') as response: build=json.load(response)
for asset in build['delivery']['assets']:
    with get(asset['gzip']) as response:
        assert response.headers.get('Content-Encoding') is None, 'Explicit archive must not auto-decompress'
        assert 'immutable' in response.headers['Cache-Control']
        data=gzip.decompress(response.read())
        assert len(data)==asset['size']
        assert hashlib.sha256(data).hexdigest()==asset['sha256']
    with get(asset['file'], {'Accept-Encoding':'gzip'}) as response:
        assert response.headers['Content-Encoding']=='gzip'
        data=gzip.decompress(response.read())
        assert hashlib.sha256(data).hexdigest()==asset['sha256']
    with get(asset['file'], {'Accept-Encoding':'identity'}) as response:
        assert response.headers.get('Content-Encoding') is None
        assert hashlib.sha256(response.read()).hexdigest()==asset['sha256']
try: get('missing-file.wasm')
except urllib.error.HTTPError as error: assert error.code==404
else: raise AssertionError('Missing assets must return 404')
print('CONTAINER_HTTP_CHECKS_PASSED', build['version'])
