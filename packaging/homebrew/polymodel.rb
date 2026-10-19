# Template for the ryaninvents/homebrew-tap repository (Formula/polymodel.rb).
# See docs/releasing.md for how to fill in url/sha256 for each release.
class Polymodel < Formula
  desc "Merge multiple LLMs into one OpenAI-compatible model"
  homepage "https://github.com/ryaninvents/polymodel"
  url "https://registry.npmjs.org/@ryaninvents/polymodel/-/polymodel-0.1.0.tgz"
  sha256 "REPLACE_WITH_TARBALL_SHA256"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  service do
    run [opt_bin/"polymodel", "serve"]
    keep_alive true
    log_path var/"log/polymodel.log"
    error_log_path var/"log/polymodel.log"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/polymodel --version")
  end
end
