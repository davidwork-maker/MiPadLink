#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <signal.h>

#include <dlfcn.h>
#include <optional>
#include <sstream>
#include <string>
#include <sys/select.h>
#include <unistd.h>
#include <vector>

@class CGVirtualDisplayDescriptor;

@interface CGVirtualDisplayMode : NSObject
@property(readonly, nonatomic) CGFloat refreshRate;
@property(readonly, nonatomic) NSUInteger width;
@property(readonly, nonatomic) NSUInteger height;
- (instancetype)initWithWidth:(NSUInteger)width height:(NSUInteger)height refreshRate:(CGFloat)refreshRate;
@end

@interface CGVirtualDisplaySettings : NSObject
@property(nonatomic) unsigned int hiDPI;
@property(retain, nonatomic) NSArray<CGVirtualDisplayMode *> *modes;
- (instancetype)init;
@end

@interface CGVirtualDisplay : NSObject
@property(readonly, nonatomic) CGDirectDisplayID displayID;
- (instancetype)initWithDescriptor:(CGVirtualDisplayDescriptor *)descriptor;
- (BOOL)applySettings:(CGVirtualDisplaySettings *)settings;
@end

@interface CGVirtualDisplayDescriptor : NSObject
@property(retain, nonatomic) NSString *name;
@property(nonatomic) unsigned int maxPixelsHigh;
@property(nonatomic) unsigned int maxPixelsWide;
@property(nonatomic) CGSize sizeInMillimeters;
@property(nonatomic) unsigned int serialNum;
@property(nonatomic) unsigned int productID;
@property(nonatomic) unsigned int vendorID;
@property(copy, nonatomic) void (^terminationHandler)(id, CGVirtualDisplay *);
- (instancetype)init;
@end

static volatile sig_atomic_t gShouldRun = 1;

static void HandleSignal(int) {
  gShouldRun = 0;
}

static std::optional<std::string> GetOption(const std::vector<std::string> &args, const std::string &key) {
  const std::string prefix = "--" + key + "=";
  for (const auto &arg : args) {
    if (arg.rfind(prefix, 0) == 0) {
      return arg.substr(prefix.size());
    }
  }
  return std::nullopt;
}

static bool HasFlag(const std::vector<std::string> &args, const std::string &key) {
  const std::string flag = "--" + key;
  for (const auto &arg : args) {
    if (arg == flag) return true;
  }
  return false;
}

static unsigned long StableHash(const std::string &value) {
  unsigned long hash = 5381;
  for (char c : value) {
    hash = ((hash << 5) + hash) + static_cast<unsigned long>(c);
  }
  return hash;
}

static NSString *ToNSString(const std::string &value) {
  return [NSString stringWithUTF8String:value.c_str()];
}

static NSData *JsonData(id object) {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:&error];
  if (!data) {
    NSString *message = error ? error.localizedDescription : @"json-encode-failed";
    fprintf(stderr, "%s\n", message.UTF8String);
    exit(1);
  }
  return data;
}

static void PrintJson(id object) {
  NSData *data = JsonData(object);
  fwrite(data.bytes, 1, data.length, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

static int PrintUsage() {
  fprintf(stderr, "Usage:\n");
  fprintf(stderr, "  padlink-virtual-display list\n");
  fprintf(stderr, "  padlink-virtual-display accessibility\n");
  fprintf(stderr, "  padlink-virtual-display capture --display-id=ID --output=/tmp/frame.jpg [--quality=0.8]\n");
  fprintf(stderr, "  padlink-virtual-display input --display-id=ID --x=0.5 --y=0.5 [--action=move|down|up|tap]\n");
  fprintf(stderr, "  padlink-virtual-display create --width=1920 --height=1080 [--refresh=60] [--name=PadLink] [--ppi=110] [--hiDPI] [--mirror]\n");
  return 1;
}

static bool IsAccessibilityTrusted(bool prompt = false) {
  const void *keys[] = {kAXTrustedCheckOptionPrompt};
  const void *values[] = {prompt ? kCFBooleanTrue : kCFBooleanFalse};
  CFDictionaryRef options = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  bool trusted = AXIsProcessTrustedWithOptions(options);
  CFRelease(options);
  return trusted;
}

static NSArray *ListDisplays() {
  uint32_t maxDisplays = 32;
  CGDirectDisplayID displayIDs[32];
  uint32_t count = 0;
  CGError error = CGGetOnlineDisplayList(maxDisplays, displayIDs, &count);
  if (error != kCGErrorSuccess) {
    fprintf(stderr, "failed-to-list-displays:%d\n", error);
    exit(1);
  }

  NSMutableArray *result = [NSMutableArray arrayWithCapacity:count];
  for (uint32_t index = 0; index < count; index += 1) {
    CGDirectDisplayID displayID = displayIDs[index];
    CGRect bounds = CGDisplayBounds(displayID);
    NSDictionary *item = @{
      @"displayId": @(displayID),
      @"width": @(CGRectGetWidth(bounds)),
      @"height": @(CGRectGetHeight(bounds)),
      @"originX": @(CGRectGetMinX(bounds)),
      @"originY": @(CGRectGetMinY(bounds)),
      @"main": @(displayID == CGMainDisplayID())
    };
    [result addObject:item];
  }
  return result;
}

static int RunList() {
  PrintJson(ListDisplays());
  return 0;
}

static int RunAccessibility() {
  PrintJson(@{
    @"trusted": @(IsAccessibilityTrusted(false))
  });
  return 0;
}

static CGImageRef CreateDisplayImageWithFallback(CGDirectDisplayID displayID) {
  using CGDisplayCreateImageFn = CGImageRef (*)(CGDirectDisplayID);
  auto createImage = reinterpret_cast<CGDisplayCreateImageFn>(dlsym(RTLD_DEFAULT, "CGDisplayCreateImage"));
  if (!createImage) return nullptr;

  for (int attempt = 0; attempt < 8; attempt += 1) {
    CGImageRef image = createImage(displayID);
    if (image) return image;
    usleep(100000);
  }
  return nullptr;
}

static int RunCapture(const std::vector<std::string> &args) {
  auto displayIdValue = GetOption(args, "display-id");
  auto outputValue = GetOption(args, "output");
  if (!displayIdValue || !outputValue) {
    fprintf(stderr, "capture requires --display-id and --output\n");
    return 1;
  }

  double quality = 0.75;
  if (auto qualityValue = GetOption(args, "quality")) {
    quality = std::stod(*qualityValue);
    if (quality < 0.1) quality = 0.1;
    if (quality > 1.0) quality = 1.0;
  }

  CGDirectDisplayID displayID = static_cast<CGDirectDisplayID>(std::stoul(*displayIdValue));
  CGImageRef image = CreateDisplayImageWithFallback(displayID);
  if (!image) {
    fprintf(stderr, "capture-failed:no-image\n");
    return 3;
  }

  CGRect displayBounds = CGDisplayBounds(displayID);
  size_t pixelWidth = CGImageGetWidth(image);
  size_t pixelHeight = CGImageGetHeight(image);
  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(nullptr, pixelWidth, pixelHeight, 8, 0, colorSpace, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(colorSpace);
  if (!context) {
    CGImageRelease(image);
    fprintf(stderr, "capture-failed:no-context\n");
    return 4;
  }

  CGContextDrawImage(context, CGRectMake(0, 0, pixelWidth, pixelHeight), image);
  CGPoint cursor = [NSEvent mouseLocation];
  if (CGRectContainsPoint(displayBounds, cursor)) {
    CGFloat localX = (cursor.x - CGRectGetMinX(displayBounds)) * (static_cast<CGFloat>(pixelWidth) / CGRectGetWidth(displayBounds));
    CGFloat localY = (cursor.y - CGRectGetMinY(displayBounds)) * (static_cast<CGFloat>(pixelHeight) / CGRectGetHeight(displayBounds));
    CGFloat radius = 10.0;
    CGContextSetRGBFillColor(context, 1.0, 0.18, 0.18, 0.9);
    CGContextFillEllipseInRect(context, CGRectMake(localX - radius, localY - radius, radius * 2.0, radius * 2.0));
    CGContextSetRGBStrokeColor(context, 1.0, 1.0, 1.0, 0.95);
    CGContextSetLineWidth(context, 2.0);
    CGContextStrokeEllipseInRect(context, CGRectMake(localX - radius - 2.0, localY - radius - 2.0, (radius + 2.0) * 2.0, (radius + 2.0) * 2.0));
  }
  CGImageRelease(image);

  CGImageRef composedImage = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  if (!composedImage) {
    fprintf(stderr, "capture-failed:no-composed-image\n");
    return 5;
  }

  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:composedImage];
  CGImageRelease(composedImage);
  if (!rep) {
    fprintf(stderr, "capture-failed:no-bitmap\n");
    return 6;
  }

  NSDictionary *properties = @{NSImageCompressionFactor: @(quality)};
  NSData *data = [rep representationUsingType:NSBitmapImageFileTypeJPEG properties:properties];
  if (!data) {
    fprintf(stderr, "capture-failed:no-jpeg\n");
    return 7;
  }

  NSError *error = nil;
  BOOL ok = [data writeToFile:ToNSString(*outputValue) options:NSDataWritingAtomic error:&error];
  if (!ok) {
    fprintf(stderr, "capture-failed:%s\n", error.localizedDescription.UTF8String);
    return 8;
  }

  PrintJson(@{
    @"displayId": @(displayID),
    @"bytes": @(data.length),
    @"output": ToNSString(*outputValue)
  });
  return 0;
}

static CGPoint MapNormalizedPointToDisplay(CGDirectDisplayID displayID, double x, double y) {
  CGRect bounds = CGDisplayBounds(displayID);
  CGFloat clampedX = static_cast<CGFloat>(x);
  CGFloat clampedY = static_cast<CGFloat>(y);
  if (clampedX < 0.0) clampedX = 0.0;
  if (clampedX > 1.0) clampedX = 1.0;
  if (clampedY < 0.0) clampedY = 0.0;
  if (clampedY > 1.0) clampedY = 1.0;
  CGFloat usableWidth = CGRectGetWidth(bounds) > 1.0 ? CGRectGetWidth(bounds) - 1.0 : 0.0;
  CGFloat usableHeight = CGRectGetHeight(bounds) > 1.0 ? CGRectGetHeight(bounds) - 1.0 : 0.0;
  return CGPointMake(
    CGRectGetMinX(bounds) + (usableWidth * clampedX),
    CGRectGetMinY(bounds) + (usableHeight * clampedY)
  );
}

static int RunInput(const std::vector<std::string> &args) {
  auto displayIdValue = GetOption(args, "display-id");
  auto xValue = GetOption(args, "x");
  auto yValue = GetOption(args, "y");
  if (!displayIdValue || !xValue || !yValue) {
    fprintf(stderr, "input requires --display-id, --x, and --y\n");
    return 1;
  }

  CGDirectDisplayID displayID = static_cast<CGDirectDisplayID>(std::stoul(*displayIdValue));
  CGPoint point = MapNormalizedPointToDisplay(displayID, std::stod(*xValue), std::stod(*yValue));
  std::string action = GetOption(args, "action").value_or("tap");

  if (!IsAccessibilityTrusted(false)) {
    fprintf(stderr, "input-failed:accessibility-not-trusted\n");
    return 4;
  }

  CGWarpMouseCursorPosition(point);

  if (action == "tap") {
    CGEventRef down = CGEventCreateMouseEvent(nullptr, kCGEventLeftMouseDown, point, kCGMouseButtonLeft);
    CGEventRef up = CGEventCreateMouseEvent(nullptr, kCGEventLeftMouseUp, point, kCGMouseButtonLeft);
    if (!down || !up) {
      if (down) CFRelease(down);
      if (up) CFRelease(up);
      fprintf(stderr, "input-failed:create-tap-events\n");
      return 2;
    }
    CGEventPost(kCGHIDEventTap, down);
    CGEventPost(kCGHIDEventTap, up);
    CFRelease(down);
    CFRelease(up);
  } else {
    CGEventType eventType = kCGEventMouseMoved;
    if (action == "down") eventType = kCGEventLeftMouseDown;
    if (action == "up") eventType = kCGEventLeftMouseUp;
    CGEventRef event = CGEventCreateMouseEvent(nullptr, eventType, point, kCGMouseButtonLeft);
    if (!event) {
      fprintf(stderr, "input-failed:create-event\n");
      return 3;
    }
    CGEventPost(kCGHIDEventTap, event);
    CFRelease(event);
  }

  PrintJson(@{
    @"displayId": @(displayID),
    @"x": @(point.x),
    @"y": @(point.y),
    @"action": ToNSString(action)
  });
  return 0;
}

static int RunCreate(const std::vector<std::string> &args) {
  auto widthValue = GetOption(args, "width");
  auto heightValue = GetOption(args, "height");
  if (!widthValue || !heightValue) {
    fprintf(stderr, "create requires --width and --height\n");
    return 1;
  }

  int width = std::stoi(*widthValue);
  int height = std::stoi(*heightValue);
  if (width <= 0 || height <= 0) {
    fprintf(stderr, "width and height must be positive\n");
    return 1;
  }

  double refreshRate = 60.0;
  if (auto refreshValue = GetOption(args, "refresh")) {
    refreshRate = std::stod(*refreshValue);
  }
  if (refreshRate < 30.0) refreshRate = 30.0;
  if (refreshRate > 120.0) refreshRate = 120.0;

  int ppi = 110;
  if (auto ppiValue = GetOption(args, "ppi")) {
    ppi = std::stoi(*ppiValue);
  }
  if (ppi < 72) ppi = 72;
  if (ppi > 300) ppi = 300;

  bool hiDPI = HasFlag(args, "hiDPI");
  bool mirror = HasFlag(args, "mirror");
  std::string name = GetOption(args, "name").value_or("PadLink Virtual Display");
  unsigned long hash = StableHash(name);

  CGDirectDisplayID mainDisplay = CGMainDisplayID();
  CGRect mainBounds = CGDisplayBounds(mainDisplay);

  CGVirtualDisplayDescriptor *descriptor = [[CGVirtualDisplayDescriptor alloc] init];
  descriptor.name = ToNSString(name);
  descriptor.maxPixelsWide = width;
  descriptor.maxPixelsHigh = height;
  descriptor.sizeInMillimeters = CGSizeMake(width * (25.4 / ppi), height * (25.4 / ppi));
  descriptor.vendorID = 0xeeee;
  descriptor.serialNum = static_cast<unsigned int>(hash & 0xffffffff);
  descriptor.productID = static_cast<unsigned int>((hash >> 16) & 0xffff);

  CGVirtualDisplay *display = [[CGVirtualDisplay alloc] initWithDescriptor:descriptor];
  if (!display) {
    fprintf(stderr, "create-failed:no-display\n");
    return 2;
  }

  CGVirtualDisplaySettings *settings = [[CGVirtualDisplaySettings alloc] init];
  settings.hiDPI = hiDPI ? 1 : 0;
  CGVirtualDisplayMode *mode = [[CGVirtualDisplayMode alloc] initWithWidth:width height:height refreshRate:refreshRate];
  if (hiDPI) {
    CGVirtualDisplayMode *lowResMode = [[CGVirtualDisplayMode alloc] initWithWidth:(NSUInteger)(width / 2) height:(NSUInteger)(height / 2) refreshRate:refreshRate];
    settings.modes = @[mode, lowResMode];
  } else {
    settings.modes = @[mode];
  }

  if (![display applySettings:settings]) {
    fprintf(stderr, "create-failed:apply-settings\n");
    return 3;
  }

  CGDisplayConfigRef config = nil;
  CGBeginDisplayConfiguration(&config);
  int originX = static_cast<int>(CGRectGetMaxX(mainBounds));
  int originY = static_cast<int>(CGRectGetMinY(mainBounds));
  CGConfigureDisplayOrigin(config, display.displayID, originX, originY);
  if (mirror) {
    CGConfigureDisplayMirrorOfDisplay(config, display.displayID, mainDisplay);
  } else {
    CGConfigureDisplayMirrorOfDisplay(config, display.displayID, kCGNullDirectDisplay);
  }
  CGCompleteDisplayConfiguration(config, kCGConfigureForSession);

  PrintJson(@{
    @"displayId": @(display.displayID),
    @"width": @(width),
    @"height": @(height),
    @"name": ToNSString(name),
    @"originX": @(originX),
    @"originY": @(originY),
    @"mirror": @(mirror)
  });

  signal(SIGINT, HandleSignal);
  signal(SIGTERM, HandleSignal);

  while (gShouldRun) {
    fd_set readSet;
    FD_ZERO(&readSet);
    FD_SET(STDIN_FILENO, &readSet);

    timeval timeout;
    timeout.tv_sec = 0;
    timeout.tv_usec = 250000;

    int ready = select(STDIN_FILENO + 1, &readSet, nullptr, nullptr, &timeout);
    if (ready < 0) break;
    if (ready == 0) continue;
    if (FD_ISSET(STDIN_FILENO, &readSet)) {
      char buffer[16];
      ssize_t bytesRead = read(STDIN_FILENO, buffer, sizeof(buffer));
      if (bytesRead <= 0) break;
    }
  }

  display = nil;
  descriptor = nil;
  settings = nil;
  return 0;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      return PrintUsage();
    }

    std::string command = argv[1];
    std::vector<std::string> args;
    for (int index = 2; index < argc; index += 1) {
      args.emplace_back(argv[index]);
    }

    if (command == "list") return RunList();
    if (command == "accessibility") return RunAccessibility();
    if (command == "capture") return RunCapture(args);
    if (command == "input") return RunInput(args);
    if (command == "create") return RunCreate(args);
    return PrintUsage();
  }
}
