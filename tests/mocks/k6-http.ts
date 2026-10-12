// tests/mocks/k6-http.ts
const http = {
  get: (url: string, params?: any) => ({
    status: 200,
    body: "{}",
    json: () => ({}),
  }),
  post: (url: string, body?: any, params?: any) => ({
    status: 200,
    body: "{}",
    json: () => ({}),
  }),
};

export default http;
