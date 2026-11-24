import 'package:flutter/material.dart';

import 'package:smartwardrobe/core/app_copy.dart';
import 'package:smartwardrobe/core/icons/sw_icon.dart';
import 'package:smartwardrobe/core/theme/app_colors.dart';
import 'package:smartwardrobe/core/theme/app_spacing.dart';
import 'package:smartwardrobe/core/theme/app_typography.dart';
import 'package:smartwardrobe/core/widgets/sw_widgets.dart';

class Composer extends StatelessWidget {
  const Composer({
    super.key,
    required this.controller,
    required this.onSend,
    required this.onMatchPhoto,
    this.busy = false,
  });

  final TextEditingController controller;
  final void Function([String?]) onSend;
  final VoidCallback onMatchPhoto;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            Insets.lg,
            Insets.md,
            Insets.lg,
            Insets.md,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                height: 34,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  physics: const BouncingScrollPhysics(),
                  itemCount: AppCopy.stylistSuggestions.length,
                  separatorBuilder: (_, _) => const SizedBox(width: Insets.sm),
                  itemBuilder: (context, i) {
                    final label = AppCopy.stylistSuggestions[i];
                    return SwChip(
                      label: label,
                      dense: true,
                      onTap: () => onSend(label),
                    );
                  },
                ),
              ),
              const SizedBox(height: Insets.md),
              Row(
                children: [
                  Tooltip(
                    message: 'Match an outfit photo to your wardrobe',
                    child: GestureDetector(
                      onTap: busy ? null : onMatchPhoto,
                      child: Container(
                        width: 46,
                        height: 46,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: AppColors.iconTint,
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.border),
                        ),
                        child: const SwIconView(
                          SwIcon.camera,
                          size: 19,
                          color: AppColors.primary,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: Insets.sm),
                  Expanded(
                    child: TextField(
                      controller: controller,
                      style: AppText.field,
                      cursorColor: AppColors.primary,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (v) => onSend(),
                      decoration: const InputDecoration(
                        hintText: 'Ask your personal stylist...',
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: Insets.lg,
                          vertical: Insets.md,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: Insets.sm),
                  GestureDetector(
                    onTap: busy ? null : () => onSend(),
                    child: Container(
                      width: 46,
                      height: 46,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: busy
                            ? AppColors.primary.withValues(alpha: 0.35)
                            : AppColors.primary,
                        shape: BoxShape.circle,
                      ),
                      child: const SwIconView(
                        SwIcon.send,
                        size: 19,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}