#!/usr/bin/env ruby
# frozen_string_literal: true

# SoundDrop v6.0 — Native Ruby Bencode Encoder & BitTorrent InfoHash (BEP-0003) Utility
# Generates real Bencoded metainfo dictionaries, SHA-1 / SHA-256 InfoHashes, and Magnet URIs
# strictly from real local files (Zero Mock Data).

require 'digest'
require 'uri'

module SoundDrop
  module Bencode
    module_function

    def encode(value)
      case value
      when Integer
        "i#{value}e".b
      when String
        raw = value.dup.force_encoding(Encoding::BINARY)
        "#{raw.bytesize}:".b + raw
      when Symbol
        encode(value.to_s)
      when Array
        'l'.b + value.map { |item| encode(item) }.join.b + 'e'.b
      when Hash
        sorted = value.keys.map(&:to_s).sort
        body = sorted.map do |k|
          val = value[k] || value[k.to_sym]
          encode(k) + encode(val)
        end.join.b
        'd'.b + body + 'e'.b
      else
        raise ArgumentError, "Unsupported Bencode type: #{value.class}"
      end
    end

    def build_magnet_for_file(file_path, piece_length: 16_384)
      raise Errno::ENOENT, file_path unless File.file?(file_path)

      raw_bytes = File.binread(file_path)
      pieces = +''.b
      offset = 0
      while offset < raw_bytes.bytesize
        slice = raw_bytes.byteslice(offset, piece_length)
        pieces << Digest::SHA1.digest(slice)
        offset += piece_length
      end

      info_dict = {
        'length' => raw_bytes.bytesize,
        'name' => File.basename(file_path),
        'piece length' => piece_length,
        'pieces' => pieces
      }

      encoded_info = encode(info_dict)
      info_hash_v1 = Digest::SHA1.hexdigest(encoded_info)
      info_hash_v2 = Digest::SHA256.hexdigest(encoded_info)

      {
        file_name: File.basename(file_path),
        file_size: raw_bytes.bytesize,
        info_hash_v1: info_hash_v1,
        info_hash_v2: info_hash_v2,
        magnet_uri: "magnet:?xt=urn:btih:#{info_hash_v1}&dn=#{URI.encode_www_form_component(File.basename(file_path))}&xl=#{raw_bytes.bytesize}"
      }
    end
  end
end

if __FILE__ == $PROGRAM_NAME && ARGV[0]
  puts SoundDrop::Bencode.build_magnet_for_file(ARGV[0]).inspect
end
