import 'dart:async';

import 'package:flutter/material.dart';

import '../../app.dart';
import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';

/// Frame 5 - email and password sign in (backend `POST /auth/login`).
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController(text: 'karim@fashiontech.com');
  final _password = TextEditingController(text: 'wardrobe2024');
  bool _obscure = true;
  bool _busy = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false) || _busy) return;
    setState(() => _busy = true);
    bool ok = false;
    try {
      ok = await AppState.instance
          .login(_email.text.trim(), _password.text)
          .timeout(const Duration(seconds: 15));
    } catch (_) {
      ok = false;
    }
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      Navigator.of(context).pushNamedAndRemoveUntil(Routes.shell, (_) => false);
    } else {
      _toast(
        context,
        'Login failed: ${AppState.instance.lastError ?? 'unknown error'}\n'
        'Is the backend running? (backend → npm start)',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return SwScreen(
      scroll: true,
      padding: const EdgeInsets.fromLTRB(
        Insets.xl,
        Insets.lg,
        Insets.xl,
        Insets.xxl,
      ),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(height: swTopAnchor(context, 92)),
            const Center(child: _AuthBadge()),
            const SizedBox(height: Insets.lg),
            Text(
              'Welcome Back',
              textAlign: TextAlign.center,
              style: AppText.h3,
            ),
            const SizedBox(height: Insets.xs),
            Text(
              'Sign in to access your digital closet',
              textAlign: TextAlign.center,
              style: AppText.body,
            ),
            const SizedBox(height: Insets.xxl),
            SwField(
              label: 'Email Address',
              controller: _email,
              hint: 'karim@fashiontech.com',
              keyboardType: TextInputType.emailAddress,
              validator: (v) => (v == null || !v.contains('@'))
                  ? 'Enter a valid email'
                  : null,
            ),
            const SizedBox(height: Insets.lg),
            SwField(
              label: 'Password',
              controller: _password,
              hint: 'Enter your password',
              obscure: _obscure,
              validator: (v) =>
                  (v == null || v.length < 6) ? 'At least 6 characters' : null,
              suffix: _ObscureToggle(
                obscured: _obscure,
                onTap: () => setState(() => _obscure = !_obscure),
              ),
            ),
            const SizedBox(height: Insets.xl),
            Align(
              alignment: Alignment.centerRight,
              child: GestureDetector(
                onTap: () => _toast(context, 'Password reset link sent.'),
                child: Text(
                  'Forgot Password?',
                  style: AppText.labelStrong.copyWith(color: AppColors.primary),
                ),
              ),
            ),
            const SizedBox(height: Insets.xxl),
            SwButton(label: _busy ? 'Signing in…' : 'Login', onTap: _submit),
            const SizedBox(height: Insets.xl),
            const _OrDivider(),
            const SizedBox(height: Insets.xl),
            SwOutlineButton(label: 'Sign in with Google', onTap: _submit),
            const SizedBox(height: Insets.xxl),
            _InlineLink(
              before: "Don't have an account?",
              action: 'Create Account',
              onTap: () => Navigator.of(context).pushNamed(Routes.signUp),
            ),
          ],
        ),
      ),
    );
  }
}

/// "Already have an account? Login" style footer link.
class _InlineLink extends StatelessWidget {
  const _InlineLink({
    required this.before,
    required this.action,
    required this.onTap,
  });

  final String before;
  final String action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Wrap(
        alignment: WrapAlignment.center,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(before, style: AppText.body),
          GestureDetector(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.only(left: 4),
              child: Text(
                action,
                style: AppText.bodyStrong.copyWith(color: AppColors.primary),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Frame 6 - account creation.
class SignUpScreen extends StatefulWidget {
  const SignUpScreen({super.key});

  @override
  State<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends State<SignUpScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController(text: 'Karim');
  final _email = TextEditingController(text: 'karim@fashiontech.com');
  final _password = TextEditingController(text: 'wardrobe2024');
  final _confirm = TextEditingController(text: 'wardrobe2024');
  bool _obscure = true;
  bool _obscureConfirm = true;
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false) || _busy) return;
    setState(() => _busy = true);
    final ok = await AppState.instance.register(
      _name.text.trim(),
      _email.text.trim(),
      _password.text,
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      Navigator.of(context).pushNamedAndRemoveUntil(Routes.shell, (_) => false);
    } else {
      _toast(
        context,
        'Backend offline — check that `npm start` is running in backend/.',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return SwScreen(
      scroll: true,
      padding: const EdgeInsets.fromLTRB(
        Insets.xl,
        Insets.lg,
        Insets.xl,
        Insets.xxl,
      ),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(height: swTopAnchor(context, 80)),
            const Center(child: _AuthBadge()),
            const SizedBox(height: Insets.lg),
            Text(
              'Create Account',
              textAlign: TextAlign.center,
              style: AppText.h3,
            ),
            const SizedBox(height: Insets.xs),
            Text(
              'Begin your personal fashion journey',
              textAlign: TextAlign.center,
              style: AppText.body,
            ),
            const SizedBox(height: Insets.xxl),
            SwField(
              label: 'Full Name',
              controller: _name,
              hint: 'Karim',
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Enter your name' : null,
            ),
            const SizedBox(height: Insets.lg),
            SwField(
              label: 'Email Address',
              controller: _email,
              hint: 'karim@fashiontech.com',
              keyboardType: TextInputType.emailAddress,
              validator: (v) => (v == null || !v.contains('@'))
                  ? 'Enter a valid email'
                  : null,
            ),
            const SizedBox(height: Insets.lg),
            SwField(
              label: 'Password',
              controller: _password,
              hint: 'Enter your password',
              obscure: _obscure,
              validator: (v) =>
                  (v == null || v.length < 6) ? 'At least 6 characters' : null,
              suffix: _ObscureToggle(
                obscured: _obscure,
                onTap: () => setState(() => _obscure = !_obscure),
              ),
            ),
            const SizedBox(height: Insets.lg),
            SwField(
              label: 'Confirm Password',
              controller: _confirm,
              hint: 'Repeat your password',
              obscure: _obscureConfirm,
              validator: (v) =>
                  (v != _password.text) ? 'Passwords do not match' : null,
              suffix: _ObscureToggle(
                obscured: _obscureConfirm,
                onTap: () => setState(() => _obscureConfirm = !_obscureConfirm),
              ),
            ),
            const SizedBox(height: Insets.xxl),
            SwButton(
              label: _busy ? 'Creating…' : 'Create Account',
              onTap: _submit,
            ),
            const SizedBox(height: Insets.xxxl),
            _InlineLink(
              before: 'Already have an account?',
              action: 'Login',
              onTap: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      ),
    );
  }
}

/// Square outlined badge shown above both auth headlines.
class _AuthBadge extends StatelessWidget {
  const _AuthBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 48,
      height: 48,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(Radii.md),
        border: Border.all(color: AppColors.border),
      ),
      child: const SwIconView(
        SwIcon.circleX,
        size: 20,
        color: AppColors.primary,
      ),
    );
  }
}

/// Show / hide affordance inside a password field.
class _ObscureToggle extends StatelessWidget {
  const _ObscureToggle({required this.obscured, required this.onTap});

  final bool obscured;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Padding(
        padding: const EdgeInsets.only(left: Insets.sm),
        child: SwIconView(
          obscured ? SwIcon.eye : SwIcon.eyeOff,
          size: 18,
          color: AppColors.textSecondary,
        ),
      ),
    );
  }
}

/// Hairline rule with a centred "or continue with" label.
class _OrDivider extends StatelessWidget {
  const _OrDivider();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Expanded(child: Divider(height: 1)),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: Insets.md),
          child: Text('or continue with', style: AppText.caption),
        ),
        const Expanded(child: Divider(height: 1)),
      ],
    );
  }
}

void _toast(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}
