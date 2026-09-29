import 'package:flutter/material.dart';

import '../icons/sw_icon.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// Filled pill button used for every primary action.
class SwButton extends StatelessWidget {
  const SwButton({
    super.key,
    required this.label,
    this.onTap,
    this.expand = true,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onTap;
  final bool expand;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null && !busy;

    final content = busy
        ? const SizedBox.square(
            dimension: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              valueColor: AlwaysStoppedAnimation(Colors.white),
            ),
          )
        : Text(label, style: AppText.button.copyWith(color: Colors.white));

    return Opacity(
      opacity: enabled ? 1 : 0.55,
      child: Material(
        color: AppColors.primary,
        borderRadius: Radii.pillRadius,
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: Radii.pillRadius,
          child: Container(
            height: Sizes.buttonHeight,
            alignment: Alignment.center,
            padding: EdgeInsets.symmetric(horizontal: expand ? Insets.xl : 28),
            child: content,
          ),
        ),
      ),
    );
  }
}

/// Outlined pill button for secondary and tertiary actions.
class SwOutlineButton extends StatelessWidget {
  const SwOutlineButton({
    super.key,
    required this.label,
    this.onTap,
    this.expand = true,
    this.foreground = AppColors.textPrimary,
  });

  final String label;
  final VoidCallback? onTap;
  final bool expand;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: Radii.pillRadius,
      child: InkWell(
        onTap: onTap,
        borderRadius: Radii.pillRadius,
        child: Container(
          height: Sizes.buttonHeight,
          alignment: Alignment.center,
          padding: EdgeInsets.symmetric(horizontal: expand ? Insets.xl : 28),
          decoration: BoxDecoration(
            borderRadius: Radii.pillRadius,
            border: Border.all(color: AppColors.border),
          ),
          child: Text(label, style: AppText.button.copyWith(color: foreground)),
        ),
      ),
    );
  }
}

/// Pill shaped selectable chip used for filters, tags and suggestions.
class SwChip extends StatelessWidget {
  const SwChip({
    super.key,
    required this.label,
    this.selected = false,
    this.onTap,
    this.icon,
    this.tone = SwChipTone.neutral,
    this.dense = false,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;
  final IconData? icon;
  final SwChipTone tone;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final Color bg;
    final Color fg;
    final Border? border;

    switch (tone) {
      case SwChipTone.neutral:
        bg = selected ? AppColors.primary : AppColors.surface;
        fg = selected ? Colors.white : AppColors.textPrimary;
        border = selected ? null : Border.all(color: AppColors.border);
      case SwChipTone.tinted:
        bg = selected ? AppColors.primary : AppColors.tint;
        fg = selected ? Colors.white : AppColors.primary;
        border = null;
      case SwChipTone.success:
        bg = selected ? AppColors.primary : AppColors.surface;
        fg = selected ? Colors.white : AppColors.textPrimary;
        border = selected ? null : Border.all(color: AppColors.border);
    }

    final chip = AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      padding: EdgeInsets.symmetric(
        horizontal: dense ? Insets.md : Insets.lg,
        vertical: dense ? 6 : 9,
      ),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: Radii.pillRadius,
        border: border,
      ),
      child: Text(
        label,
        style: (dense ? AppText.label : AppText.bodyStrong).copyWith(
          color: fg,
          fontSize: dense ? 11 : 13,
        ),
      ),
    );

    if (onTap == null) return chip;
    return GestureDetector(onTap: onTap, child: chip);
  }
}

enum SwChipTone { neutral, tinted, success }

/// Labelled text field matching the design's outlined input.
class SwField extends StatelessWidget {
  const SwField({
    super.key,
    required this.label,
    this.controller,
    this.hint,
    this.obscure = false,
    this.keyboardType,
    this.validator,
    this.suffix,
    this.onSubmitted,
    this.textInputAction,
  });

  final String label;
  final TextEditingController? controller;
  final String? hint;
  final bool obscure;
  final TextInputType? keyboardType;
  final String? Function(String?)? validator;
  final Widget? suffix;
  final ValueChanged<String>? onSubmitted;
  final TextInputAction? textInputAction;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppText.label),
        const SizedBox(height: Insets.sm),
        TextFormField(
          controller: controller,
          obscureText: obscure,
          keyboardType: keyboardType,
          validator: validator,
          onFieldSubmitted: onSubmitted,
          textInputAction: textInputAction,
          style: AppText.field,
          cursorColor: AppColors.primary,
          decoration: InputDecoration(
            hintText: hint,
            suffixIcon: suffix,
            suffixIconConstraints: const BoxConstraints(
              minWidth: 44,
              minHeight: 44,
            ),
          ),
        ),
      ],
    );
  }
}

/// Rounded rectangle surface with an optional hairline border.
class SwCard extends StatelessWidget {
  const SwCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(Insets.lg),
    this.onTap,
    this.color,
    this.border = true,
    this.radius = Radii.lg,
    this.clip = false,
  });

  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final Color? color;
  final bool border;
  final double radius;
  final bool clip;

  @override
  Widget build(BuildContext context) {
    final decoration = BoxDecoration(
      color: color ?? AppColors.surface,
      borderRadius: BorderRadius.circular(radius),
      border: border ? Border.all(color: AppColors.border) : null,
    );

    Widget content = Padding(padding: padding, child: child);

    if (clip) {
      content = ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: content,
      );
    }

    if (onTap != null) {
      content = Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(radius),
          child: content,
        ),
      );
    }

    return DecoratedBox(decoration: decoration, child: content);
  }
}

/// Section heading with an optional trailing link.
class SwSectionHeader extends StatelessWidget {
  const SwSectionHeader({
    super.key,
    required this.title,
    this.actionLabel,
    this.onAction,
    this.padding = const EdgeInsets.only(bottom: Insets.md),
  });

  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Row(
        children: [
          Expanded(child: Text(title, style: AppText.h4)),
          if (actionLabel != null)
            GestureDetector(
              onTap: onAction,
              child: Text(
                actionLabel!,
                style: AppText.label.copyWith(color: AppColors.primary),
              ),
            ),
        ],
      ),
    );
  }
}

/// Small rounded square holding a line icon on a tinted background.
class SwIconBadge extends StatelessWidget {
  const SwIconBadge({
    super.key,
    required this.icon,
    this.size = 44,
    this.iconSize = 20,
    this.color = AppColors.primary,
    this.background = AppColors.iconTint,
    this.circle = false,
  });

  final SwIcon icon;
  final double size;
  final double iconSize;
  final Color color;
  final Color background;
  final bool circle;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: background,
        borderRadius: circle
            ? BorderRadius.circular(size / 2)
            : BorderRadius.circular(Radii.md),
      ),
      child: SwIconView(icon, size: iconSize, color: color),
    );
  }
}

/// "92% Match" style badge.
class SwMatchBadge extends StatelessWidget {
  const SwMatchBadge({super.key, required this.match, this.onDark = false});

  final int match;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: onDark ? Colors.white : AppColors.tint,
        borderRadius: Radii.pillRadius,
      ),
      child: Text(
        '$match% Match',
        style: AppText.labelStrong.copyWith(
          color: onDark ? AppColors.primary : AppColors.primary,
        ),
      ),
    );
  }
}

/// Tinted informational banner with an optional warning variant.
class SwBanner extends StatelessWidget {
  const SwBanner({
    super.key,
    required this.message,
    this.title,
    this.icon,
    this.tone = SwBannerTone.info,
    this.onTap,
  });

  final String message;
  final String? title;
  final SwIcon? icon;
  final SwBannerTone tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, border) = switch (tone) {
      SwBannerTone.info => (AppColors.tint, AppColors.primary, AppColors.tint),
      SwBannerTone.warning => (
        AppColors.dangerSurface,
        AppColors.danger,
        AppColors.dangerBorder,
      ),
    };

    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(Insets.lg),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: Radii.cardRadius,
          border: Border.all(color: border),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (icon != null) ...[
              SwIconView(icon!, size: 18, color: fg),
              const SizedBox(width: Insets.md),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (title != null) ...[
                    Text(
                      title!,
                      style: AppText.overline.copyWith(
                        color: fg,
                        fontSize: 9,
                        letterSpacing: 1,
                      ),
                    ),
                    const SizedBox(height: 4),
                  ],
                  Text(
                    message,
                    style: AppText.body.copyWith(
                      color: fg,
                      fontSize: 13,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
            if (onTap != null) ...[
              const SizedBox(width: Insets.sm),
              SwIconView(SwIcon.chevronRight, size: 18, color: fg),
            ],
          ],
        ),
      ),
    );
  }
}

enum SwBannerTone { info, warning }

/// Circular avatar that falls back to the person's initial.
class SwAvatar extends StatelessWidget {
  const SwAvatar({super.key, required this.image, this.size = 44, this.name});

  final String image;
  final double size;
  final String? name;

  @override
  Widget build(BuildContext context) {
    return ClipOval(
      child: Image.asset(
        image,
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stack) => Container(
          width: size,
          height: size,
          alignment: Alignment.center,
          color: AppColors.tint,
          child: Text(
            (name ?? '?').characters.first.toUpperCase(),
            style: AppText.cardTitle.copyWith(color: AppColors.primary),
          ),
        ),
      ),
    );
  }
}

/// Data-driven photo: bundled asset path or uploaded http(s) URL.
/// Use for any image that comes from the backend or wardrobe data.
class SwPhoto extends StatelessWidget {
  const SwPhoto({super.key, required this.path, this.fit = BoxFit.cover});

  final String path;
  final BoxFit fit;

  static bool isRemote(String path) =>
      path.startsWith('http://') || path.startsWith('https://');

  @override
  Widget build(BuildContext context) {
    if (isRemote(path)) {
      return Image.network(
        path,
        fit: fit,
        errorBuilder: (context, error, stack) =>
            const ColoredBox(color: AppColors.tint),
      );
    }
    return Image.asset(path, fit: fit);
  }
}

/// Product photo with the app's standard rounded corners and cover fit.
class SwProductImage extends StatelessWidget {
  const SwProductImage({
    super.key,
    required this.image,
    this.height,
    this.width,
    this.radius = Radii.md,
    this.background,
  });

  final String image;
  final double? height;
  final double? width;
  final double radius;
  final Color? background;

  @override
  Widget build(BuildContext context) {
    final fallback = SizedBox(
      height: height,
      width: width,
      child: const Center(
        child: SwIconView(
          SwIcon.shirt,
          size: 22,
          color: AppColors.textTertiary,
        ),
      ),
    );
    final Widget img;
    if (image.startsWith('http://') || image.startsWith('https://')) {
      // Real uploaded photo served by the backend (POST /wardrobe/upload).
      img = Image.network(
        image,
        height: height,
        width: width,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stack) => fallback,
      );
    } else {
      img = Image.asset(
        image,
        height: height,
        width: width,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stack) => fallback,
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: ColoredBox(
        color: background ?? AppColors.background,
        child: img,
      ),
    );
  }
}
