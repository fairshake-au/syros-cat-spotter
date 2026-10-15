import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import request from "supertest";

// SYC-304: test/setup.ts points supertest at [::1] by replacing its private
// serverAddress method. If a supertest upgrade stops calling it, every test
// silently goes back to 127.0.0.1 and the Mac-only flake returns, with
// nothing failing. This file fails instead.
describe("supertest's connection (test/setup.ts)", () => {
  it("reaches the app over ::1 whenever the app is listening on IPv6", async () => {
    const server = http.createServer((req, res) => {
      res.end(req.socket.remoteAddress);
    });
    const test = request(server).get("/");
    const { family } = server.address() as AddressInfo;
    const res = await test;
    expect(res.status).toBe(200);
    if (family === "IPv6") {
      expect(res.text).toBe("::1");
    } else {
      expect(res.text).toBe("127.0.0.1");
    }
  });
});
