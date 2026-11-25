import 'package:flutter/material.dart';
import '../../../core/icons/sw_icon.dart';
import '../../../core/widgets/sw_widgets.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/models.dart';

/// Backend avatar when one is set, the bundled photo otherwise, and the
/// account initials when neither is available.
///
/// Tapping opens the change-picture flow. While an upload is in flight the
/// previous image stays visible behind a spinner, so the user can see what is
/// still saved.
class ProfileAvatar extends StatelessWidget {
  const ProfileAvatar({
    super.key,
    required this.profile,
    required this.onTap,
    required this.busy,
  });

  final UserProfile profile;
  final VoidCallback onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    const size = 56.0;
    final remote = profile.avatarUrl;
    final fallback = SwInitialAvatar(name: profile.name, size: size);

    return Semantics(
      button: true,
      label: 'Change profile picture',
      child: InkWell(
        onTap: busy ? null : onTap,
        customBorder: const CircleBorder(),
        child: Stack(
          alignment: Alignment.center,
          children: [
            ClipOval(
              child: remote != null
                  ? Image.network(
                      remote,
                      width: size,
                      height: size,
                      fit: BoxFit.cover,
                      errorBuilder: (context, _, _) => fallback,
                    )
                  : fallback,
            ),
            if (busy)
              Container(
                width: size,
                height: size,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.black.withValues(alpha: 0.45),
                ),
                child: const Center(
                  child: SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            if (!busy)
              Positioned(
                right: -2,
                bottom: -2,
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.surface,
                    border: Border.all(color: AppColors.background, width: 2),
                  ),
                  child: const SwIconView(
                    SwIcon.camera,
                    size: 12,
                    color: AppColors.primary,
                    strokeWidth: 2,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}