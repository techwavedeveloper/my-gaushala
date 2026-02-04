const request = require('supertest');
const child = require('child_process');
let serverProcess;

beforeAll(done => {
  serverProcess = child.spawn('node', ['index.js'], { cwd: __dirname + '/../', env: process.env, stdio: 'ignore' });
  // small delay to let server start
  setTimeout(done, 500);
});

afterAll(() => {
  if (serverProcess) serverProcess.kill();
});

test('health endpoint', async () => {
  const res = await request('http://localhost:3000').get('/api/health');
  expect(res.statusCode).toBe(200);
  expect(res.body.ok).toBe(true);
}, 10000);

test('get donors (empty or array)', async () => {
  const res = await request('http://localhost:3000').get('/api/donors');
  expect(res.statusCode).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
}, 10000);
