import 'package:flutter/material.dart';

import 'package:smartwardrobe/core/theme/app_spacing.dart';
import '../add_clothing_shared.dart';
import 'tag_cell.dart';

class TagGrid extends StatelessWidget {
  const TagGrid({super.key, required this.photo, required this.onChanged});

  final Staged photo;
  final void Function(String label, String value) onChanged;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = Insets.md;
        final width = (constraints.maxWidth - gap) / 2;

        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (final label in tagFields.keys)
              SizedBox(
                width: width,
                child: TagCell(
                  label: label,
                  value: tagValue(photo.analysis, label),
                  onSaved: (v) => onChanged(label, v),
                ),
              ),
          ],
        );
      },
    );
  }
}