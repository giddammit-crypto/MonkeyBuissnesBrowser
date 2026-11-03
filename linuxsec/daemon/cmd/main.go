package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/netip"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

const (
	SocketPath  = "/run/linuxsec/daemon.sock"
	SocketDir   = "/run/linuxsec"
	SocketGroup = "linuxsec"
)

var interfaceNamePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,15}$`)

type Request struct {
	Action     string   `json:"action"`
	VpnIface   string   `json:"vpnIface,omitempty"`
	EndpointIP string   `json:"endpointIp,omitempty"`
	DnsServers []string `json:"dnsServers,omitempty"`
}

type Response struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

type DaemonServer struct {
	mu                   sync.Mutex
	killSwitch           bool
	ipv6Blocked          bool
	originalIPv6Disabled *string
	vpnIface             string
	endpointIP           string
}

func main() {
	if os.Geteuid() != 0 {
		log.Printf("Warning: linuxsecd running without UID 0 (root). Some firewall actions will require root.")
	}

	server := &DaemonServer{}

	if err := os.MkdirAll(SocketDir, 0750); err != nil {
		log.Fatalf("Failed to create socket directory: %v", err)
	}
	if group, err := lookupGroupGid(SocketGroup); err == nil {
		if err := os.Chown(SocketDir, os.Getuid(), group); err != nil {
			log.Printf("Failed to set socket directory group: %v", err)
		}
		if err := os.Chmod(SocketDir, 0770); err != nil {
			log.Printf("Failed to set socket directory permissions: %v", err)
		}
	} else {
		_ = os.Chmod(SocketDir, 0700)
	}

	// Remove stale socket if exists
	os.Remove(SocketPath)

	listener, err := net.Listen("unix", SocketPath)
	if err != nil {
		log.Fatalf("Failed to bind unix socket %s: %v", SocketPath, err)
	}
	defer os.Remove(SocketPath)
	defer listener.Close()

	// The socket is intentionally group-accessible, never world-accessible.
	// Packaging creates the linuxsec group and adds the desktop user to it.
	if err := os.Chmod(SocketPath, 0660); err != nil {
		log.Printf("Failed to chmod socket: %v", err)
	}
	if group, err := lookupGroupGid(SocketGroup); err == nil {
		if err := os.Chown(SocketPath, os.Getuid(), group); err != nil {
			log.Printf("Failed to set socket group: %v", err)
		}
	} else {
		log.Printf("Socket group %q is unavailable; keeping the socket restricted to its owner: %v", SocketGroup, err)
		if err := os.Chmod(SocketPath, 0600); err != nil {
			log.Printf("Failed to restrict socket: %v", err)
		}
	}

	log.Printf("linuxsecd daemon started on %s", SocketPath)

	// Clean up on termination signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		<-sigCh
		log.Println("Shutting down linuxsecd, cleaning up firewall...")
		server.cleanup()
		os.Remove(SocketPath)
		os.Exit(0)
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("Accept error: %v", err)
			continue
		}
		go server.handleConnection(conn)
	}
}

func (s *DaemonServer) handleConnection(conn net.Conn) {
	defer conn.Close()

	var req Request
	decoder := json.NewDecoder(conn)
	if err := decoder.Decode(&req); err != nil {
		json.NewEncoder(conn).Encode(Response{
			Success: false,
			Error:   fmt.Sprintf("Invalid JSON request: %v", err),
		})
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	var resp Response
	switch req.Action {
	case "enable_killswitch":
		err := s.applyKillSwitch(req.VpnIface, req.EndpointIP)
		if err != nil {
			resp = Response{Success: false, Error: err.Error()}
		} else {
			s.killSwitch = true
			s.vpnIface = req.VpnIface
			s.endpointIP = req.EndpointIP
			resp = Response{Success: true, Message: "Kill Switch active"}
		}

	case "disable_killswitch":
		err := s.removeKillSwitch()
		if err != nil {
			resp = Response{Success: false, Error: err.Error()}
		} else {
			s.killSwitch = false
			resp = Response{Success: true, Message: "Kill Switch disabled"}
		}

	case "block_ipv6":
		err := s.setIpv6Block(true)
		if err != nil {
			resp = Response{Success: false, Error: err.Error()}
		} else {
			s.ipv6Blocked = true
			resp = Response{Success: true, Message: "IPv6 traffic blocked"}
		}

	case "unblock_ipv6":
		err := s.setIpv6Block(false)
		if err != nil {
			resp = Response{Success: false, Error: err.Error()}
		} else {
			s.ipv6Blocked = false
			resp = Response{Success: true, Message: "IPv6 traffic unblocked"}
		}

	case "status":
		resp = Response{
			Success: true,
			Message: fmt.Sprintf("KillSwitch=%v, IPv6Blocked=%v, Iface=%s", s.killSwitch, s.ipv6Blocked, s.vpnIface),
		}

	default:
		resp = Response{Success: false, Error: fmt.Sprintf("Unknown action: %s", req.Action)}
	}

	json.NewEncoder(conn).Encode(resp)
}

func (s *DaemonServer) applyKillSwitch(vpnIface, endpointIP string) error {
	if vpnIface != "" && !interfaceNamePattern.MatchString(vpnIface) {
		return fmt.Errorf("invalid VPN interface name")
	}
	host, err := endpointHost(endpointIP)
	if err != nil {
		return err
	}
	log.Printf("Applying Kill Switch for iface=%s, endpoint=%s", vpnIface, endpointIP)

	// Clean any previous rules first
	s.removeKillSwitch()

	// Try nftables first
	if _, err := exec.LookPath("nft"); err == nil {
		nftScript := fmt.Sprintf(`
add table inet linuxsec_ks
flush table inet linuxsec_ks
add chain inet linuxsec_ks output { type filter hook output priority 0; policy drop; }
add rule inet linuxsec_ks output oifname "lo" accept
add rule inet linuxsec_ks output ct state established,related accept
add rule inet linuxsec_ks output udp dport 67-68 accept
add rule inet linuxsec_ks output udp sport 67-68 accept
`)
		if host != "" {
			family := "ip"
			if strings.Contains(host, ":") {
				family = "ip6"
			}
			nftScript += fmt.Sprintf("add rule inet linuxsec_ks output %s daddr %s accept\n", family, host)
		}
		if vpnIface != "" {
			nftScript += fmt.Sprintf("add rule inet linuxsec_ks output oifname \"%s*\" accept\n", vpnIface)
		} else {
			nftScript += "add rule inet linuxsec_ks output oifname \"linuxsec*\" accept\n"
			nftScript += "add rule inet linuxsec_ks output oifname \"wg*\" accept\n"
			nftScript += "add rule inet linuxsec_ks output oifname \"tun*\" accept\n"
		}

		cmd := exec.Command("nft", "-f", "-")
		cmd.Stdin = strings.NewReader(nftScript)
		out, err := cmd.CombinedOutput()
		if err == nil {
			log.Printf("Kill Switch applied with nftables")
			return nil
		}
		log.Printf("nftables failed (%v: %s), falling back to iptables", err, string(out))
	}

	// Fallback to iptables
	cmds := [][]string{
		{"iptables", "-N", "LINUXSEC_KS"},
		{"iptables", "-I", "OUTPUT", "1", "-j", "LINUXSEC_KS"},
		{"iptables", "-A", "LINUXSEC_KS", "-o", "lo", "-j", "ACCEPT"},
		{"iptables", "-A", "LINUXSEC_KS", "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"},
		{"iptables", "-A", "LINUXSEC_KS", "-p", "udp", "--dport", "67:68", "--sport", "67:68", "-j", "ACCEPT"},
	}

	if host != "" {
		cmds = append(cmds, []string{"iptables", "-A", "LINUXSEC_KS", "-d", host, "-j", "ACCEPT"})
	}

	if vpnIface != "" {
		cmds = append(cmds, []string{"iptables", "-A", "LINUXSEC_KS", "-o", vpnIface, "-j", "ACCEPT"})
	} else {
		cmds = append(cmds, []string{"iptables", "-A", "LINUXSEC_KS", "-o", "linuxsec+", "-j", "ACCEPT"})
		cmds = append(cmds, []string{"iptables", "-A", "LINUXSEC_KS", "-o", "wg+", "-j", "ACCEPT"})
		cmds = append(cmds, []string{"iptables", "-A", "LINUXSEC_KS", "-o", "tun+", "-j", "ACCEPT"})
	}

	cmds = append(cmds, []string{"iptables", "-A", "LINUXSEC_KS", "-j", "DROP"})

	for _, c := range cmds {
		if err := exec.Command(c[0], c[1:]...).Run(); err != nil {
			// Do not report a kill switch as active if even one rule failed.
			_ = s.removeKillSwitch()
			return fmt.Errorf("iptables command %q failed: %w", strings.Join(c, " "), err)
		}
	}

	return nil
}

func (s *DaemonServer) removeKillSwitch() error {
	// Try nftables removal
	if _, err := exec.LookPath("nft"); err == nil {
		_ = exec.Command("nft", "delete", "table", "inet", "linuxsec_ks").Run()
	}

	// Remove iptables rules if any
	_ = exec.Command("iptables", "-D", "OUTPUT", "-j", "LINUXSEC_KS").Run()
	_ = exec.Command("iptables", "-F", "LINUXSEC_KS").Run()
	_ = exec.Command("iptables", "-X", "LINUXSEC_KS").Run()

	return nil
}

func (s *DaemonServer) setIpv6Block(block bool) error {
	const sysctlPath = "/proc/sys/net/ipv6/conf/all/disable_ipv6"
	if block && s.originalIPv6Disabled == nil {
		if value, err := os.ReadFile(sysctlPath); err == nil {
			trimmed := strings.TrimSpace(string(value))
			s.originalIPv6Disabled = &trimmed
		}
	}

	val := "0"
	if block {
		val = "1"
	} else if s.originalIPv6Disabled != nil {
		val = *s.originalIPv6Disabled
	}
	cmd := exec.Command("sysctl", "-w", fmt.Sprintf("net.ipv6.conf.all.disable_ipv6=%s", val))
	if err := cmd.Run(); err != nil {
		return err
	}
	if !block {
		s.originalIPv6Disabled = nil
	}
	return nil
}

func (s *DaemonServer) cleanup() {
	s.removeKillSwitch()
	if s.ipv6Blocked {
		s.setIpv6Block(false)
	}
}

func init() {
	// Ensure directory exists
	_ = os.MkdirAll(filepath.Dir(SocketPath), 0750)
}

func lookupGroupGid(name string) (int, error) {
	group, err := os.ReadFile(filepath.Join("/etc/group"))
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(group), "\n") {
		parts := strings.Split(line, ":")
		if len(parts) >= 3 && parts[0] == name {
			gid, err := strconv.Atoi(parts[2])
			if err != nil {
				return 0, fmt.Errorf("invalid gid for group %q", name)
			}
			return gid, nil
		}
	}
	return 0, fmt.Errorf("group %q not found", name)
}

func endpointHost(endpoint string) (string, error) {
	if endpoint == "" {
		return "", nil
	}
	host := endpoint
	if h, port, err := net.SplitHostPort(endpoint); err == nil {
		if _, err := strconv.ParseUint(port, 10, 16); err != nil || port == "0" {
			return "", fmt.Errorf("invalid VPN endpoint port")
		}
		host = h
	} else if strings.Count(endpoint, ":") == 1 {
		return "", fmt.Errorf("invalid VPN endpoint")
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return "", fmt.Errorf("invalid VPN endpoint IP")
	}
	return addr.String(), nil
}
