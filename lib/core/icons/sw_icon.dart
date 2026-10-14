import 'dart:ui' as ui;

import 'package:flutter/widgets.dart';

import 'svg_path_parser.dart';

/// The outlined icon vocabulary used throughout the design.
///
/// Every glyph is authored on a 24x24 grid with round caps and joins, so it can
/// be scaled to any size and stroked at any weight.
enum SwIcon {
  // Navigation
  home,
  shirt,
  sparkle,
  layers,
  user,

  // Chrome
  chevronLeft,
  chevronRight,
  chevronDown,
  arrowLeft,
  moreVertical,
  close,
  search,
  sliders,
  menu,

  // Actions
  plus,
  check,
  send,
  trash,
  edit,
  share,
  heart,
  heartFill,
  star,
  starFill,
  thumbUp,
  thumbDown,
  filter,
  refresh,

  // Media / input
  camera,
  image,
  upload,
  eye,
  eyeOff,
  bookmark,

  // Domain
  calendar,
  bag,
  shoppingCart,
  tag,
  sun,
  cloud,
  pin,
  clock,
  hangers,
  box,
  palette,
  grid,
  ruler,
  sparkleCircle,
  circleX,
  circleCheck,
  circleInfo,
  alert,
  chart,
}

/// Renders a [SwIcon] glyph.
///
/// The design uses thin outlined icons that are not part of the Material set,
/// so the whole family is drawn from SVG path data.
class SwIconView extends StatelessWidget {
  const SwIconView(
    this.icon, {
    super.key,
    this.size = 24,
    this.color = const Color(0xFF1E1C1A),
    this.strokeWidth = 1.7,
  });

  final SwIcon icon;
  final double size;
  final Color color;
  final double strokeWidth;

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(
        painter: _SwIconPainter(
          icon: icon,
          color: color,
          strokeWidth: strokeWidth,
        ),
      ),
    );
  }
}

class _SwIconPainter extends CustomPainter {
  const _SwIconPainter({
    required this.icon,
    required this.color,
    required this.strokeWidth,
  });

  final SwIcon icon;
  final Color color;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final glyph = SwGlyph.of(icon);
    final k = size.shortestSide / 24;

    canvas.save();
    canvas.scale(k);

    final stroke = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final fill = Paint()
      ..color = color
      ..style = PaintingStyle.fill;

    for (final d in glyph.strokes) {
      canvas.drawPath(parseSvgPath(d), stroke);
    }
    for (final d in glyph.fills) {
      canvas.drawPath(parseSvgPath(d), fill);
    }

    canvas.restore();
  }

  @override
  bool shouldRepaint(_SwIconPainter old) =>
      old.icon != icon || old.color != color || old.strokeWidth != strokeWidth;
}

class SwGlyph {
  const SwGlyph(this.strokes, [this.fills = const []]);

  final List<String> strokes;
  final List<String> fills;

  static const Map<SwIcon, SwGlyph> _map = {
    SwIcon.home: SwGlyph([
      'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8',
      'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999'
          'A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    ]),
    SwIcon.shirt: SwGlyph([
      'M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47'
          'a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15'
          'a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z',
    ]),
    SwIcon.sparkle: SwGlyph([
      'M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94'
          'A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14'
          'A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06'
          'a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z',
      'M20 3v4',
      'M22 5h-4',
      'M4 17v2',
      'M5 18H3',
    ]),
    SwIcon.sparkleCircle: SwGlyph(
      [
        'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
        'M12 8.4l1.3 3.1 3.1 1.3-3.1 1.3L12 17.2l-1.3-3.1-3.1-1.3 3.1-1.3z',
      ],
      ['M12 9.4l.95 2.25 2.25.95-2.25.95L12 15.8l-.95-2.25-2.25-.95 2.25-.95z'],
    ),
    SwIcon.layers: SwGlyph([
      'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91'
          'a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z',
      'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65',
      'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65',
    ]),
    SwIcon.user: SwGlyph([
      'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2',
      'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    ]),
    SwIcon.chevronLeft: SwGlyph(['m15 18-6-6 6-6']),
    SwIcon.chevronRight: SwGlyph(['m9 18 6-6-6-6']),
    SwIcon.chevronDown: SwGlyph(['m6 9 6 6 6-6']),
    SwIcon.arrowLeft: SwGlyph(['M19 12H5', 'm12 19-7-7 7-7']),
    SwIcon.moreVertical: SwGlyph([], [
      'M12 5.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
      'M12 13.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
      'M12 21.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
    ]),
    SwIcon.close: SwGlyph(['M18 6 6 18', 'm6 6 12 12']),
    SwIcon.search: SwGlyph([
      'M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
      'm21 21-4.3-4.3',
    ]),
    SwIcon.sliders: SwGlyph([
      'M10 5H3',
      'M12 19H3',
      'M14 3v4',
      'M16 17v4',
      'M21 12h-9',
      'M21 19h-5',
      'M21 5h-7',
      'M8 10v4',
      'M8 12H3',
    ]),
    SwIcon.thumbUp: SwGlyph([
      'M7 10v12',
      'M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8'
          'a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z',
    ]),
    SwIcon.thumbDown: SwGlyph([
      'M17 14V2',
      'M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8'
          'a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88z',
    ]),
    SwIcon.filter: SwGlyph(['M3 6h18', 'M7 12h10', 'M10 18h4']),
    SwIcon.menu: SwGlyph(['M4 7h16', 'M4 12h16', 'M4 17h16']),
    SwIcon.plus: SwGlyph(['M5 12h14', 'M12 5v14']),
    SwIcon.check: SwGlyph(['M20 6 9 17l-5-5']),
    SwIcon.send: SwGlyph([
      'M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.63l-19 6.5'
          'a.5.5 0 0 0-.03.94l7.93 3.18a2 2 0 0 1 1.11 1.11z',
      'm21.85 2.15-10.94 10.94',
    ]),
    SwIcon.trash: SwGlyph([
      'M3 6h18',
      'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
      'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    ]),
    SwIcon.edit: SwGlyph([
      'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7',
      'M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z',
    ]),
    SwIcon.share: SwGlyph([
      'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7',
      'M16 6l-4-4-4 4',
      'M12 2v13',
    ]),
    SwIcon.heart: SwGlyph([
      'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2'
          '-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z',
    ]),
    SwIcon.heartFill: SwGlyph([], [
      'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2'
          '-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z',
    ]),
    SwIcon.star: SwGlyph([
      'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16'
          'l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878'
          'l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0'
          'L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879'
          'L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
    ]),
    SwIcon.starFill: SwGlyph([], [
      'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16'
          'l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878'
          'l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0'
          'L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879'
          'L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
    ]),
    SwIcon.refresh: SwGlyph([
      'M21 12a9 9 0 0 0-15.3-6.4L3 8',
      'M3 3v5h5',
      'M3 12a9 9 0 0 0 15.3 6.4L21 16',
      'M21 21v-5h-5',
    ]),
    SwIcon.camera: SwGlyph([
      'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9'
          'a2 2 0 0 0-2-2h-3z',
      'M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    ]),
    SwIcon.image: SwGlyph([
      'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
      'M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
      'm21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21',
    ]),
    SwIcon.upload: SwGlyph([
      'M12 21V13',
      'M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24',
      'm8 17 4-4 4 4',
    ]),
    SwIcon.eye: SwGlyph([
      'M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7'
          ' 10.75 10.75 0 0 1-19.88 0',
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    ]),
    SwIcon.eyeOff: SwGlyph([
      'M10.73 5.08A10.74 10.74 0 0 1 21.94 11.65a1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49',
      'M14.08 14.16a3 3 0 0 1-4.24-4.24',
      'M17.48 17.5A10.75 10.75 0 0 1 2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14',
      'm2 2 20 20',
    ]),
    SwIcon.bookmark: SwGlyph([
      'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
    ]),
    SwIcon.calendar: SwGlyph([
      'M8 2v4',
      'M16 2v4',
      'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
      'M3 10h18',
    ]),
    SwIcon.bag: SwGlyph([
      'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z',
      'M3 6h18',
      'M16 10a4 4 0 0 1-8 0',
    ]),
    SwIcon.shoppingCart: SwGlyph([
      'M10 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
      'M20 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
      'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43',
      'M5.71 8h12.79',
    ]),
    SwIcon.tag: SwGlyph([
      'M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7'
          'a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z',
      'M8.5 8.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    ]),
    SwIcon.sun: SwGlyph([
      'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
      'M12 2v2',
      'M12 20v2',
      'm4.93 4.93 1.41 1.41',
      'm17.66 17.66 1.41 1.41',
      'M2 12h2',
      'M20 12h2',
      'm6.34 17.66-1.41 1.41',
      'm19.07 4.93-1.41 1.41',
    ]),
    SwIcon.cloud: SwGlyph([
      'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z',
    ]),
    SwIcon.pin: SwGlyph([
      'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z',
      'M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    ]),
    SwIcon.clock: SwGlyph([
      'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
      'M12 6v6l4 2',
    ]),
    SwIcon.hangers: SwGlyph([
      'M12 7v4',
      'M12 7a2 2 0 1 1 2-2c0 .8-.4 1.4-1 1.7',
      'M4 20h16l-7.2-6.1a1 1 0 0 0-1.4 0z',
    ]),
    SwIcon.box: SwGlyph([
      'M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4'
          'a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z',
      'm3.3 7 8.7 5 8.7-5',
      'M12 22V12',
    ]),
    SwIcon.palette: SwGlyph([
      'M12 22a10 10 0 1 1 10-10 4 4 0 0 1-4 4h-1.5a2 2 0 0 0-1.4 3.4'
          ' 2 2 0 0 1-1.4 3.4 2 2 0 0 1-1.7.2z',
      'M7.5 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
      'M10 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
      'M15 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
    ]),
    SwIcon.grid: SwGlyph([
      'M4.5 3h3A1.5 1.5 0 0 1 9 4.5v3A1.5 1.5 0 0 1 7.5 9h-3A1.5 1.5 0 0 1 3 7.5v-3'
          'A1.5 1.5 0 0 1 4.5 3z',
      'M16.5 3h3A1.5 1.5 0 0 1 21 4.5v3A1.5 1.5 0 0 1 19.5 9h-3A1.5 1.5 0 0 1 15 7.5v-3'
          'A1.5 1.5 0 0 1 16.5 3z',
      'M4.5 15h3A1.5 1.5 0 0 1 9 16.5v3A1.5 1.5 0 0 1 7.5 21h-3A1.5 1.5 0 0 1 3 19.5v-3'
          'A1.5 1.5 0 0 1 4.5 15z',
      'M16.5 15h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3'
          'A1.5 1.5 0 0 1 16.5 15z',
    ]),
    SwIcon.ruler: SwGlyph([
      'M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7'
          'a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z',
      'm7.5 10.5 2 2',
      'm10.5 7.5 2 2',
      'm13.5 4.5 2 2',
      'm4.5 13.5 2 2',
    ]),
    SwIcon.circleX: SwGlyph([
      'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
      'm15 9-6 6',
      'm9 9 6 6',
    ]),
    SwIcon.circleCheck: SwGlyph([
      'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
      'm9 12 2 2 4-4',
    ]),
    SwIcon.circleInfo: SwGlyph([
      'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
      'M12 16v-4',
      'M12 8h.01',
    ]),
    SwIcon.alert: SwGlyph([
      'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z',
      'M12 9v4',
      'M12 17h.01',
    ]),
    SwIcon.chart: SwGlyph([
      'M3 3v16a2 2 0 0 0 2 2h16',
      'M7 16v-4',
      'M12 16V8',
      'M17 16v-6',
    ]),
  };

  static SwGlyph of(SwIcon icon) => _map[icon]!;
}

/// Test seam: exposes the raw path strings behind each glyph.
@visibleForTesting
abstract final class SwGlyphPaths {
  static List<String> strokesOf(SwIcon icon) => SwGlyph.of(icon).strokes;

  static List<String> fillsOf(SwIcon icon) => SwGlyph.of(icon).fills;
}

/// Paints [pathData] scaled from the 24x24 icon grid onto a [canvas].
///
/// Exposed so charts and custom decorations can reuse the same geometry.
void paintSwPath(
  Canvas canvas,
  Size size,
  String pathData, {
  required Color color,
  double strokeWidth = 1.7,
  PaintingStyle style = PaintingStyle.stroke,
}) {
  final k = size.shortestSide / 24;
  canvas.save();
  canvas.scale(k);
  canvas.drawPath(
    parseSvgPath(pathData),
    Paint()
      ..color = color
      ..style = style
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round,
  );
  canvas.restore();
}

/// Ensures `dart:ui` stays referenced for the icon painter's Canvas type.
typedef SwCanvas = ui.Canvas;
