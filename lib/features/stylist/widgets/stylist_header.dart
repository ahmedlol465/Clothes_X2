import 'package:flutter/material.dart';

import 'package:smartwardrobe/core/icons/sw_icon.dart';
import 'package:smartwardrobe/core/theme/app_colors.dart';
import 'package:smartwardrobe/core/theme/app_spacing.dart';
import 'package:smartwardrobe/core/theme/app_typography.dart';
import 'package:smartwardrobe/core/widgets/sw_screen.dart';

class StylistHeader extends StatelessWidget {
  const StylistHeader({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Insets.lg,
        Insets.md,
        Insets.lg,
        Insets.md,
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: AppColors.primary,
              shape: BoxShape.circle,
            ),
            child: const SwIconView(
              SwIcon.sparkle,
              size: 19,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: Insets.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('AI Stylist', style: AppText.h4),
                Text('Your personal fashion assistant', style: AppText.caption),
              ],
            ),
          ),
          SwIconButton(
            icon: SwIconButtonKind.close,
            onTap: () => ScaffoldMessenger.of(context)
              ..hideCurrentSnackBar()
              ..showSnackBar(
                const SnackBar(content: Text('Conversation cleared.')),
              ),
          ),
        ],
      ),
    );
  }
}