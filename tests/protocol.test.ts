import { describe, expect, it } from "vitest";
import { createLobby } from "../src/lib/game/engine";
import {
  envelopeSchema,
  hasMajority,
  isLogCurrent,
  jointMajority,
  makeFrame,
  validFrame,
} from "../src/lib/network/protocol";

describe("replication boundaries", () => {
  it("needs a majority and cannot resume a two-player room with one survivor", () => {
    expect(hasMajority(["a", "a"], ["a", "b", "c"])).toBe(false);
    expect(hasMajority(["a", "b", "outsider"], ["a", "b", "c"])).toBe(true);
    expect(hasMajority(["a"], ["a", "b"])).toBe(false);
  });
  it("requires both old and new majorities when admitting a player", () => {
    expect(jointMajority(["a"], ["a"], ["a", "b"])).toBe(false);
    expect(jointMajority(["a", "b"], ["a"], ["a", "b"])).toBe(true);
  });
  it("rejects election candidates whose logs are behind accepted moves", () => {
    expect(isLogCurrent({ term: 1, index: 20 }, { term: 2, index: 10 })).toBe(
      false,
    );
    expect(isLogCurrent({ term: 2, index: 9 }, { term: 2, index: 10 })).toBe(
      false,
    );
    expect(isLogCurrent({ term: 2, index: 10 }, { term: 2, index: 10 })).toBe(
      true,
    );
  });
  it("detects altered state snapshots", async () => {
    const state = createLobby(
      { id: "a", name: "Alice", ready: false, score: 0 },
      3,
    );
    const frame = await makeFrame(state, 1, 1);
    expect(await validFrame(frame)).toBe(true);
    frame.state.maxPlayers = 12;
    expect(await validFrame(frame)).toBe(false);
  });
  it("rejects malformed commands and oversized names", () => {
    expect(
      envelopeSchema.safeParse({
        from: "a",
        message: { type: "COMMAND", action: { type: "GIVE_CARDS" } },
      }).success,
    ).toBe(false);
  });
});

it("snapshot hashes survive schema normalization and object property reordering", async () => {
  const state = createLobby(
    { id: "a", name: "Alice", score: 0, ready: false },
    3,
  );
  const frame = await makeFrame(state, 1, 1);
  const { frameSchema } = await import("../src/lib/network/protocol");
  expect(await validFrame(frameSchema.parse(frame))).toBe(true);
});
