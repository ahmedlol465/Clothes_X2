import 'package:flutter/material.dart';

import '../../app.dart';
import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../data/app_state.dart';
import '../../data/mock_data.dart';

/// Frame 1 - the branded splash shown while the app boots.
///
/// Doubles as the session check: the stored bearer token is validated against
/// `GET /users/me` while the wordmark is on screen, so a returning user lands
/// in the app and a signed-out one lands on Login.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  /// The wordmark is held on screen for this long regardless of how fast the
  /// session check responds, so a cached token does not produce a jarring
  /// flash straight into the shell.
  static const _minimumSplash = Duration(milliseconds: 2200);

  /// Guards against routing twice when the timer and the session check finish
  /// close together.
  bool _routed = false;

  @override
  void initState() {
    super.initState();
    _boot();
  }

  /// The splash ends only when the session check has settled *and* the minimum
  /// display time has passed. Routing on a bare timer would strand a valid
  /// user on onboarding whenever the network is slower than the animation.
  Future<void> _boot() async {
    await AppState.instance.restoreSession();
    await Future<void>.delayed(_minimumSplash);
    _route();
  }

  /// Authenticated users skip onboarding; everyone else sees it as before.
  void _route() {
    if (!mounted || _routed) return;
    _routed = true;
    if (AppState.instance.isAuthenticated) {
      Navigator.of(context).pushReplacementNamed(Routes.shell);
      return;
    }
    Navigator.of(context).pushReplacementNamed(Routes.onboarding);
  }

  @override
  Widget build(BuildContext context) {
    return SwScreen(
      child: Stack(
        children: [
          Center(
            child: Padding(
              // Nudges the lockup slightly above true centre, as in the design.
              padding: const EdgeInsets.only(bottom: 72),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const _LogoMark(),
                  const SizedBox(height: Insets.xl),
                  Text('SmartWardrobe', style: AppText.wordmark),
                  const SizedBox(height: Insets.sm),
                  Text('YOUR AI PERSONAL STYLIST', style: AppText.tagline),
                ],
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 28,
            child: Center(
              child: Text(
                MockData.appVersion,
                style: AppText.caption.copyWith(fontSize: 11),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The circular t-shirt badge above the wordmark.
class _LogoMark extends StatelessWidget {
  const _LogoMark();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 100,
      height: 100,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: AppColors.surface,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: Color(0x0F1E1C1A),
            blurRadius: 24,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: const SwIconView(
        SwIcon.shirt,
        size: 40,
        color: AppColors.primary,
        strokeWidth: 1.6,
      ),
    );
  }
}
