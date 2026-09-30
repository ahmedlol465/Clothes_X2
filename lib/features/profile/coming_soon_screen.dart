import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';

/// Shared "not built yet" screen for the Profile destinations that are
/// scaffolded but not implemented: Notifications, Privacy and AI Stylist
/// Settings.
///
/// It is a real route rather than a toast, so each destination has its own
/// page to grow into later. It deliberately contains no placeholder behaviour.
class ComingSoonScreen extends StatelessWidget {
  const ComingSoonScreen({
    super.key,
    required this.title,
    required this.subtitle,
    required this.icon,
  });

  final String title;
  final String subtitle;
  final SwIcon icon;

  @override
  Widget build(BuildContext context) {
    return SwScreen(
      child: Column(
        children: [
          SwAppBar(title: title),
          Expanded(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: Insets.xl),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SwIconBadge(icon: icon, size: 72, iconSize: 30, circle: true),
                    const SizedBox(height: Insets.xl),
                    Text('Coming Soon', style: AppText.h2),
                    const SizedBox(height: Insets.md),
                    Text(
                      subtitle,
                      textAlign: TextAlign.center,
                      style: AppText.body,
                    ),
                    const SizedBox(height: Insets.xxxl),
                    SizedBox(
                      width: 220,
                      child: SwOutlineButton(
                        label: 'Go back',
                        onTap: () => Navigator.of(context).maybePop(),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
