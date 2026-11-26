import 'package:flutter/material.dart';

import '../icons/sw_icon.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// Converts an absolute Y coordinate from the Figma artboard (a 393x852 screen
/// that includes the status bar) into a spacer to place below the safe area.
///
/// Keeps the design's vertical rhythm identical on notched devices and on
/// platforms without a system inset.
double swTopAnchor(BuildContext context, double designY) {
  final inset = MediaQuery.paddingOf(context).top;
  return (designY - inset).clamp(20.0, 140.0);
}

/// Scaffold wrapper applying the app background, safe area and scroll physics.
class SwScreen extends StatelessWidget {
  const SwScreen({
    super.key,
    required this.child,
    this.scroll = false,
    this.padding = EdgeInsets.zero,
    this.bottomBar,
    this.resizeToAvoidBottomInset = true,
  });

  final Widget child;
  final bool scroll;
  final EdgeInsets padding;
  final Widget? bottomBar;
  final bool resizeToAvoidBottomInset;

  @override
  Widget build(BuildContext context) {
    final body = SafeArea(
      bottom: false,
      child: scroll
          ? SingleChildScrollView(
              padding: padding,
              physics: const BouncingScrollPhysics(
                parent: AlwaysScrollableScrollPhysics(),
              ),
              child: child,
            )
          : Padding(padding: padding, child: child),
    );

    return Scaffold(
      backgroundColor: AppColors.background,
      resizeToAvoidBottomInset: resizeToAvoidBottomInset,
      body: body,
      bottomNavigationBar: bottomBar,
    );
  }
}

/// Header used on every pushed screen: circular back button, serif title and an
/// optional trailing action.
class SwAppBar extends StatelessWidget {
  const SwAppBar({
    super.key,
    required this.title,
    this.subtitle,
    this.onBack,
    this.action,
    this.trailing,
    this.showDivider = false,
  });

  final String title;
  final String? subtitle;
  final VoidCallback? onBack;
  final Widget? action;
  final Widget? trailing;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final titleBlock = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(title, style: AppText.h1),
        if (subtitle != null) ...[
          const SizedBox(height: 2),
          Text(subtitle!, style: AppText.caption),
        ],
      ],
    );

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            Insets.lg,
            Insets.sm,
            Insets.lg,
            Insets.sm,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              SwIconButton(
                icon: SwIconButtonKind.back,
                onTap: onBack ?? () => Navigator.of(context).maybePop(),
              ),
              const SizedBox(width: Insets.md),
              Expanded(child: titleBlock),
              ?action,
              if (trailing != null) ...[
                const SizedBox(width: Insets.sm),
                trailing!,
              ],
            ],
          ),
        ),
        if (showDivider) const Divider(height: 1),
      ],
    );
  }
}

/// The circular outline button shared by headers and empty states.
class SwIconButton extends StatelessWidget {
  const SwIconButton({
    super.key,
    required this.icon,
    this.onTap,
    this.filled = false,
    this.background,
    this.size = Sizes.iconButton,
    this.iconSize = 18,
    this.badge,
  });

  const SwIconButton.back({super.key, this.onTap, this.background})
    : icon = SwIconButtonKind.back,
      filled = false,
      size = Sizes.iconButton,
      iconSize = 18,
      badge = null;

  final SwIconButtonKind icon;
  final VoidCallback? onTap;
  final bool filled;
  final Color? background;
  final double size;
  final double iconSize;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    final child = Stack(
      clipBehavior: Clip.none,
      children: [
        Container(
          width: size,
          height: size,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: filled
                ? AppColors.primary
                : (background ?? AppColors.surface),
            shape: BoxShape.circle,
            border: filled ? null : Border.all(color: AppColors.border),
          ),
          child: SwIconView(
            icon.glyph,
            size: iconSize,
            color: filled ? Colors.white : AppColors.textPrimary,
          ),
        ),
        if (badge != null)
          Positioned(
            right: -2,
            top: -2,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              decoration: const BoxDecoration(
                color: AppColors.primary,
                shape: BoxShape.circle,
              ),
              child: Text(
                badge!,
                style: AppText.overline.copyWith(
                  color: Colors.white,
                  letterSpacing: 0,
                  fontSize: 9,
                ),
              ),
            ),
          ),
      ],
    );

    if (onTap == null) return child;
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: child,
    );
  }
}

/// The header icon variants used across the app.
enum SwIconButtonKind {
  back,
  close,
  more,
  filter,
  share,
  edit,
  home,
  plus,
  bag,
  search,
  planner,
  heart,
}

extension on SwIconButtonKind {
  SwIcon get glyph => switch (this) {
    SwIconButtonKind.back => SwIcon.chevronLeft,
    SwIconButtonKind.close => SwIcon.close,
    SwIconButtonKind.more => SwIcon.moreVertical,
    SwIconButtonKind.filter => SwIcon.sliders,
    SwIconButtonKind.share => SwIcon.share,
    SwIconButtonKind.edit => SwIcon.edit,
    SwIconButtonKind.home => SwIcon.home,
    SwIconButtonKind.plus => SwIcon.plus,
    SwIconButtonKind.bag => SwIcon.bag,
    SwIconButtonKind.search => SwIcon.search,
    SwIconButtonKind.planner => SwIcon.calendar,
    SwIconButtonKind.heart => SwIcon.heart,
  };
}
