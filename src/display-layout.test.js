import test from "node:test";
import assert from "node:assert/strict";
import { describeDisplayLink, fitContain, mapPointToSource } from "./display-layout.js";

test("fitContain centers content with letterboxing", () => {
  const layout = fitContain({ width: 2560, height: 1600 }, { width: 1920, height: 1080 });

  assert.ok(layout.scale > 0);
  assert.equal(Math.round(layout.renderWidth), 1728);
  assert.equal(Math.round(layout.renderHeight), 1080);
  assert.equal(Math.round(layout.offsetX), 96);
  assert.equal(Math.round(layout.offsetY), 0);
});

test("mapPointToSource returns source coordinates and inside flag", () => {
  const point = mapPointToSource(
    { x: 960, y: 540 },
    { width: 2560, height: 1600 },
    { width: 1920, height: 1080 }
  );

  assert.equal(point.inside, true);
  assert.ok(point.x > 0);
  assert.ok(point.y > 0);
});

test("describeDisplayLink summarizes the host/client relationship", () => {
  const description = describeDisplayLink({
    host: { width: 2560, height: 1600 },
    client: { width: 1920, height: 1080 }
  });

  assert.equal(description.host.width, 2560);
  assert.equal(description.client.height, 1080);
  assert.ok(description.scale > 0);
});
