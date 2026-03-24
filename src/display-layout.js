function assertPositiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
}

export function fitContain(source, destination) {
  assertPositiveNumber(source.width, "source.width");
  assertPositiveNumber(source.height, "source.height");
  assertPositiveNumber(destination.width, "destination.width");
  assertPositiveNumber(destination.height, "destination.height");

  const scale = Math.min(
    destination.width / source.width,
    destination.height / source.height
  );
  const renderWidth = source.width * scale;
  const renderHeight = source.height * scale;
  const offsetX = (destination.width - renderWidth) / 2;
  const offsetY = (destination.height - renderHeight) / 2;

  return {
    scale,
    renderWidth,
    renderHeight,
    offsetX,
    offsetY
  };
}

export function mapPointToSource(point, source, destination) {
  if (!point || typeof point !== "object") {
    throw new Error("point must be an object");
  }
  const layout = fitContain(source, destination);
  const xOnCanvas = point.x - layout.offsetX;
  const yOnCanvas = point.y - layout.offsetY;
  const x = xOnCanvas / layout.scale;
  const y = yOnCanvas / layout.scale;

  return {
    x: Math.min(Math.max(x, 0), source.width),
    y: Math.min(Math.max(y, 0), source.height),
    inside:
      xOnCanvas >= 0 &&
      yOnCanvas >= 0 &&
      xOnCanvas <= layout.renderWidth &&
      yOnCanvas <= layout.renderHeight,
    layout
  };
}

export function describeDisplayLink({ host, client }) {
  const hostLayout = fitContain(host, client);
  return {
    host,
    client,
    scale: hostLayout.scale,
    renderSize: {
      width: hostLayout.renderWidth,
      height: hostLayout.renderHeight
    },
    offsets: {
      x: hostLayout.offsetX,
      y: hostLayout.offsetY
    }
  };
}
