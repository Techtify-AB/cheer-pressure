# The phone app's own native code (a local Expo module, found by autolinking in mobile/modules):
# the bundled web interface's server, camera and microphone permissions, the audio session.
# web/ is the static export copied in by scripts/copy-web.mjs; it is copied into the app as one
# folder (Cheer Pressure.app/web), keeping its folders, which a resource bundle would flatten.
Pod::Spec.new do |s|
  s.name           = 'CheerNative'
  s.version        = '1.0.0'
  s.summary        = 'Cheer Pressure phone app native helpers'
  s.description    = 'Serves the bundled web interface on the loopback address, asks for camera and microphone, sets the audio session.'
  s.author         = 'Cheer Pressure'
  s.homepage       = 'https://github.com/Techtify-AB/junction-companion'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'Network'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '*.swift'
  s.resources = ['web']
end
