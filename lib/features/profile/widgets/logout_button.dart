import 'package:flutter/material.dart';

import '../../../app.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/sw_widgets.dart';
import '../../../data/app_state.dart';
import '../../../data/controllers/account_controller.dart';

/// Logout: revokes the session, clears cached state and returns to Login.
///
/// The route stack is reset with `pushNamedAndRemoveUntil`, so the shell and
/// every pushed screen are destroyed — Android back cannot return here.
class LogoutButton extends StatelessWidget {
  const LogoutButton._(this._accountController);

  factory LogoutButton({Key? key, AccountController? accountController}) {
    return LogoutButton._(
      accountController ?? AppState.instance.accountController,
    );
  }

  final AccountController _accountController;

  @override
  Widget build(BuildContext context) {
    return SwOutlineButton(
      label: 'Logout',
      foreground: AppColors.danger,
      onTap: () => _confirmLogout(context),
    );
  }

  Future<void> _confirmLogout(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: Radii.cardRadius),
        title: Text('Log out?', style: AppText.h4),
        content: Text(
          'You will need to sign in again to see your style profile.',
          style: AppText.body,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(
              'Cancel',
              style: AppText.bodyStrong.copyWith(
                color: AppColors.textSecondary,
              ),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(
              'Logout',
              style: AppText.bodyStrong.copyWith(color: AppColors.danger),
            ),
          ),
        ],
      ),
    );

    if (confirmed != true || !context.mounted) return;
    await _accountController.logout();
    if (!context.mounted) return;
    Navigator.of(
      context,
      rootNavigator: true,
    ).pushNamedAndRemoveUntil(Routes.login, (_) => false);
  }
}