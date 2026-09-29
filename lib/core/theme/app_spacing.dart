import 'package:flutter/widgets.dart';

/// Spacing, radii and elevation tokens used across the app.
abstract final class Insets {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;

  /// Horizontal page gutter used by every screen.
  static const double gutter = 20;

  /// Gap between a screen title and the first block of content.
  static const double titleGap = 20;

  /// Gap between two stacked sections.
  static const double sectionGap = 24;
}

/// Corner radii lifted from the design.
abstract final class Radii {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double pill = 999;

  static const BorderRadius smRadius = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius cardRadius = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius tileRadius = BorderRadius.all(Radius.circular(md));
  static const BorderRadius sheetRadius = BorderRadius.all(Radius.circular(xl));
  static const BorderRadius pillRadius = BorderRadius.all(
    Radius.circular(pill),
  );
}

/// Fixed component heights that repeat between screens.
abstract final class Sizes {
  /// Primary / secondary full width button.
  static const double buttonHeight = 52;

  /// Text input field.
  static const double fieldHeight = 52;

  /// Circular icon button in a header.
  static const double iconButton = 40;

  /// Bottom navigation bar including the safe area inset.
  static const double navBar = 64;

  /// Product image inside a wardrobe grid cell.
  static const double gridImage = 150;

  /// Bottom navigation icon box.
  static const double navIcon = 24;
}
