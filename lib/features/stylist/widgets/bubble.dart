import 'package:flutter/material.dart';

import 'package:smartwardrobe/core/icons/sw_icon.dart';
import 'package:smartwardrobe/core/theme/app_colors.dart';
import 'package:smartwardrobe/core/theme/app_spacing.dart';
import 'package:smartwardrobe/core/theme/app_typography.dart';
import 'package:smartwardrobe/data/models.dart';
import 'outfit_suggestion.dart';
import 'match_result_card.dart';
import 'typing_dots.dart';

class Bubble extends StatelessWidget {
  const Bubble({super.key, required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    if (message.fromUser) {
      return Align(
        alignment: Alignment.centerRight,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 280),
          child: Container(
            margin: const EdgeInsets.only(left: 48),
            padding: const EdgeInsets.symmetric(
              horizontal: Insets.lg,
              vertical: Insets.md,
            ),
            decoration: const BoxDecoration(
              color: AppColors.primary,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(Radii.xl),
                topRight: Radius.circular(Radii.xl),
                bottomLeft: Radius.circular(Radii.xl),
                bottomRight: Radius.circular(Radii.xs),
              ),
            ),
            child: Text(
              message.text,
              style: AppText.body.copyWith(color: Colors.white, fontSize: 13),
            ),
          ),
        ),
      );
    }

    return Align(
      alignment: Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 300),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 26,
                  height: 26,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    color: AppColors.primary,
                    shape: BoxShape.circle,
                  ),
                  child: const SwIconView(
                    SwIcon.sparkle,
                    size: 13,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: Insets.sm),
                Flexible(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: Insets.lg,
                      vertical: Insets.md,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: const BorderRadius.only(
                        topLeft: Radius.circular(Radii.xs),
                        topRight: Radius.circular(Radii.xl),
                        bottomLeft: Radius.circular(Radii.xl),
                        bottomRight: Radius.circular(Radii.xl),
                      ),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Builder(
                      builder: (context) {
                        if (message.text.isEmpty) return const TypingDots();
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              message.text,
                              style: AppText.body.copyWith(
                                color: AppColors.textPrimary,
                                fontSize: 13,
                              ),
                            ),
                            if (message.followUp != null) ...[
                              const SizedBox(height: 6),
                              Text(
                                message.followUp!,
                                style: AppText.caption.copyWith(
                                  color: AppColors.primary,
                                ),
                              ),
                            ],
                          ],
                        );
                      },
                    ),
                  ),
                ),
              ],
            ),
            if (!message.fromUser && message.source == 'rules')
              Padding(
                padding: const EdgeInsets.only(left: 34, top: 3),
                child: Text(
                  'Rule engine — no AI key configured',
                  style: AppText.caption.copyWith(fontSize: 10),
                ),
              ),
            if (message.match != null)
              Padding(
                padding: const EdgeInsets.only(left: 34, top: Insets.sm),
                child: MatchResultCard(match: message.match!),
              ),
            if (message.outfit != null)
              Padding(
                padding: const EdgeInsets.only(left: 34, top: Insets.sm),
                child: OutfitSuggestion(outfit: message.outfit!),
              ),
          ],
        ),
      ),
    );
  }
}