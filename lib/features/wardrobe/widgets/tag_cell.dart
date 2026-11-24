import 'package:flutter/material.dart';

import 'package:smartwardrobe/core/icons/sw_icon.dart';
import 'package:smartwardrobe/core/theme/app_colors.dart';
import 'package:smartwardrobe/core/theme/app_spacing.dart';
import 'package:smartwardrobe/core/theme/app_typography.dart';
import 'package:smartwardrobe/core/widgets/sw_widgets.dart';

class TagCell extends StatelessWidget {
  const TagCell({
    super.key,
    required this.label,
    required this.value,
    required this.onSaved,
  });

  final String label;
  final String value;
  final ValueChanged<String> onSaved;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      padding: const EdgeInsets.all(Insets.md),
      onTap: () => _editTag(context),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: AppText.overline.copyWith(fontSize: 9)),
                const SizedBox(height: 3),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.bodyStrong.copyWith(fontSize: 13),
                ),
              ],
            ),
          ),
          const SwIconView(
            SwIcon.edit,
            size: 14,
            color: AppColors.textTertiary,
          ),
        ],
      ),
    );
  }

  void _editTag(BuildContext context) {
    final controller = TextEditingController(text: value);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.only(
          left: Insets.xl,
          right: Insets.xl,
          top: Insets.xl,
          bottom: MediaQuery.of(sheetContext).viewInsets.bottom + Insets.xl,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(label, style: AppText.h4),
            const SizedBox(height: Insets.lg),
            SwField(label: 'Value', controller: controller),
            const SizedBox(height: Insets.xl),
            SwButton(
              label: 'Save',
              onTap: () {
                onSaved(controller.text.trim());
                Navigator.of(sheetContext).pop();
              },
            ),
          ],
        ),
      ),
    );
  }
}