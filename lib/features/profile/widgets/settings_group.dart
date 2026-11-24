import 'package:flutter/material.dart';
import '../../../core/widgets/sw_widgets.dart';
import 'setting_row.dart';

/// Grouped list of tappable settings rows.
class SettingsGroup extends StatelessWidget {
  const SettingsGroup({super.key, required this.rows});

  final List<SettingRow> rows;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      padding: EdgeInsets.zero,
      clip: true,
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            rows[i],
            if (i != rows.length - 1)
              const Padding(
                padding: EdgeInsets.only(left: 52),
                child: Divider(height: 1),
              ),
          ],
        ],
      ),
    );
  }
}