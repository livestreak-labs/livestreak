import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, createHostRouteDeps } from "#server.js";
import { defaultHostServerConfig } from "#config/host.js";
import { iceServersForHost, readTurnConfig } from "#services/webrtc/turn.js";

const app = () => createApp(createHostRouteDeps(defaultHostServerConfig()));

describe("webrtc signaling relay", () => {
  it("round-trips an offer then an answer keyed by stream id", async () => {
    const a = app();
    const sid = "market-1";

    await request(a).get(`/webrtc/signal/${sid}/offer`).expect(404);

    await request(a)
      .post(`/webrtc/signal/${sid}/offer`)
      .send({ type: "offer", sdp: "v=0...offer" })
      .expect(201);

    const offer = await request(a).get(`/webrtc/signal/${sid}/offer`).expect(200);
    expect(offer.body).toMatchObject({ type: "offer", sdp: "v=0...offer" });

    // Answer cannot precede an offer.
    const orphan = app();
    await request(orphan)
      .post(`/webrtc/signal/${sid}/answer`)
      .send({ type: "answer", sdp: "v=0...answer" })
      .expect(404);

    await request(a)
      .post(`/webrtc/signal/${sid}/answer`)
      .send({ type: "answer", sdp: "v=0...answer" })
      .expect(201);

    const answer = await request(a).get(`/webrtc/signal/${sid}/answer`).expect(200);
    expect(answer.body).toMatchObject({ type: "answer", sdp: "v=0...answer" });

    await request(a).delete(`/webrtc/signal/${sid}`).expect(200);
    await request(a).get(`/webrtc/signal/${sid}/offer`).expect(404);
  });

  it("rejects malformed offers/answers", async () => {
    const a = app();
    await request(a).post("/webrtc/signal/s/offer").send({ sdp: "x" }).expect(400);
    await request(a).post("/webrtc/signal/s/answer").send({ type: "offer", sdp: "x" }).expect(400);
  });
});

describe("webrtc ICE advertisement — the host embeds its own TURN relay", () => {
  it("GET /webrtc/ice advertises TURN on the same host the caller reached us at", async () => {
    const a = app();
    // A container reaches us at host.docker.internal; a browser at localhost — each must get a TURN address
    // IT can reach, so the endpoint keys the TURN host off the request Host header.
    const res = await request(a).get("/webrtc/ice").set("Host", "host.docker.internal:8788").expect(200);
    expect(res.body.relayOnly).toBe(true);
    const turn = (res.body.iceServers as { urls: string; username?: string; credential?: string }[]).find(
      (s) => s.urls.startsWith("turn:")
    );
    expect(turn?.urls).toContain("host.docker.internal:");
    expect(turn?.username).toBeTruthy();
    expect(turn?.credential).toBeTruthy();
    const stun = (res.body.iceServers as { urls: string }[]).find((s) => s.urls.startsWith("stun:"));
    expect(stun?.urls).toContain("host.docker.internal:");
  });

  it("iceServersForHost builds stun + credentialed turn for the given host", () => {
    const cfg = readTurnConfig();
    const list = iceServersForHost("myhost", cfg);
    expect(list[0].urls).toBe(`stun:myhost:${cfg.port}`);
    expect(list[1].urls).toBe(`turn:myhost:${cfg.port}?transport=udp`);
    expect(list[1].username).toBe(cfg.username);
    expect(list[1].credential).toBe(cfg.credential);
  });
});
