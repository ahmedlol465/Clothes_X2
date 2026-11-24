import 'package:flutter/material.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/sw_widgets.dart';
import '../../../data/models.dart';
import 'profile_avatar.dart';

/// Name, email and registration date of the signed-in account.
class IdentityCard extends StatelessWidget {
  const IdentityCard({
    super.key,
    required this.profile,
    required this.onChangePhoto,
  });

  final UserProfile profile;
  final VoidCallback onChangePhoto;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      padding: const EdgeInsets.all(Insets.lg),
      child: Row(
        children: [
          ProfileAvatar(
            profile: profile,
            busy: false,
            onTap: onChangePhoto,
          ),
          const SizedBox(width: Insets.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  profile.name,
                  style: AppText.h4,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  profile.email,
                  style: AppText.caption,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  profile.memberSince ?? 'Member since —',
                  style: AppText.caption,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}