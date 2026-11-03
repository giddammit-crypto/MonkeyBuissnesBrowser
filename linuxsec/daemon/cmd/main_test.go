package main

import "testing"

func TestEndpointHostValidation(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "ipv4 with port", input: "198.51.100.1:51820", want: "198.51.100.1"},
		{name: "ipv6 with port", input: "[2001:db8::1]:51820", want: "2001:db8::1"},
		{name: "bare ipv6", input: "2001:db8::1", want: "2001:db8::1"},
		{name: "empty endpoint", input: "", want: ""},
		{name: "hostname rejected", input: "vpn.example:51820", wantErr: true},
		{name: "injection rejected", input: "198.51.100.1; flush ruleset", wantErr: true},
		{name: "invalid port rejected", input: "198.51.100.1:0", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := endpointHost(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected an error for %q", tt.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("endpointHost(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestInterfaceNameValidation(t *testing.T) {
	for _, name := range []string{"wg0", "linuxsec-test", "tun_1"} {
		if !interfaceNamePattern.MatchString(name) {
			t.Errorf("expected interface name %q to be accepted", name)
		}
	}
	for _, name := range []string{"../../tmp", "wg\"0", "this-interface-name-is-too-long"} {
		if interfaceNamePattern.MatchString(name) {
			t.Errorf("expected interface name %q to be rejected", name)
		}
	}
}
