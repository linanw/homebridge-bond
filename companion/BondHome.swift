import SwiftUI
import HomeKit
import UniformTypeIdentifiers

struct Room: Codable, Identifiable { let key, label: String; var id: String { key } }
struct Inventory: Codable { let identity, name: String; let rooms: [Room] }
struct BindingRecord: Codable {
    let identity: String
    let home, accessory: UUID
    let rooms: [String: UUID]
}
struct Job: Decodable {
    let id: UUID
    let identity: String
    let home, accessory: UUID
    let name: String?
    let room: UUID?
    let expires: Double
}
struct Receipt: Codable {
    let id: String
    let identity, home, accessory, name, room: String
}

@MainActor
final class Bridge: NSObject, ObservableObject, HMHomeManagerDelegate {
    private var manager: HMHomeManager!
    private var folder: URL?
    @Published var homes = [HMHome]()
    @Published var inventory: Inventory?
    @Published var homeID: UUID?
    @Published var accessoryID: UUID?
    @Published var rooms = [String: UUID]()
    @Published var note = ""
    @Published var busy = false
    override init() { super.init(); manager = HMHomeManager(); manager.delegate = self }
    nonisolated func homeManagerDidUpdateHomes(_ manager: HMHomeManager) {
        Task { @MainActor in self.homes = self.manager.homes }
    }
    var home: HMHome? { homes.first { $0.uniqueIdentifier == homeID } }
    private var defaultsKey: String { "binding-" + (inventory?.identity ?? "") }

    func open(_ url: URL) {
        do {
            guard url.startAccessingSecurityScopedResource() else { throw CocoaError(.fileReadNoPermission) }
            let inv: Inventory
            do { inv = try JSONDecoder().decode(Inventory.self, from: Data(contentsOf: url.appendingPathComponent("inventory.json"))) }
            catch { url.stopAccessingSecurityScopedResource(); throw error }
            folder?.stopAccessingSecurityScopedResource()
            folder = url; inventory = inv
            let raw = UserDefaults.standard.data(forKey: defaultsKey) ?? Data()
            let binding = try? JSONDecoder().decode(BindingRecord.self, from: raw)
            homeID = binding?.home; accessoryID = binding?.accessory; rooms = binding?.rooms ?? [:]
            note = binding == nil ? "请选择对应的家庭、配件和房间。" : "已载入本机确认的绑定。"
        } catch { note = error.localizedDescription }
    }
    func bind() {
        guard let folder, let inventory, let home,
              let accessory = home.accessories.first(where: { $0.uniqueIdentifier == accessoryID }) else { return }
        do {
            let record = BindingRecord(identity: inventory.identity, home: home.uniqueIdentifier,
                                       accessory: accessory.uniqueIdentifier, rooms: rooms.filter { pair in
                home.rooms.contains { $0.uniqueIdentifier == pair.value }
            })
            let data = try JSONEncoder().encode(record)
            try data.write(to: folder.appendingPathComponent("binding.json"), options: .atomic)
            UserDefaults.standard.set(data, forKey: defaultsKey)
            note = "已绑定。实测时请保持此页面打开。"
        } catch { note = error.localizedDescription }
    }
    func process() async {
        guard !busy, let folder, let data = UserDefaults.standard.data(forKey: defaultsKey),
              let binding = try? JSONDecoder().decode(BindingRecord.self, from: data),
              let jobData = try? Data(contentsOf: folder.appendingPathComponent("request.json")),
              let job = try? JSONDecoder().decode(Job.self, from: jobData),
              job.identity == binding.identity, job.home == binding.home, job.accessory == binding.accessory,
              let home = homes.first(where: { $0.uniqueIdentifier == binding.home }),
              let device = home.accessories.first(where: { $0.uniqueIdentifier == binding.accessory }),
              job.room.map({ binding.rooms.values.contains($0) }) ?? true,
              Date.now.timeIntervalSince1970 * 1000 < job.expires else { return }
        let output = folder.appendingPathComponent("receipt.json")
        if let bytes = try? Data(contentsOf: output), let last = try? JSONDecoder().decode(Receipt.self, from: bytes),
           last.id.lowercased() == job.id.uuidString.lowercased() { return }
        busy = true
        defer { busy = false }
        var failures: [String] = []
        if let name = job.name, device.name != name {
            do { try await device.updateName(name) } catch { failures.append(error.localizedDescription) }
        }
        if let target = job.room, device.room?.uniqueIdentifier != target,
           let room = home.rooms.first(where: { $0.uniqueIdentifier == target }),
           Date.now.timeIntervalSince1970 * 1000 < job.expires {
            do { try await home.assignAccessory(device, to: room) } catch { failures.append(error.localizedDescription) }
        }
        guard let observed = manager.homes.first(where: { $0.uniqueIdentifier == job.home })?.accessories
            .first(where: { $0.uniqueIdentifier == job.accessory }) else { note = "HomeKit 无法读回配件"; return }
        let receipt = Receipt(id: job.id.uuidString.lowercased(), identity: job.identity,
                              home: job.home.uuidString, accessory: job.accessory.uuidString,
                              name: observed.name, room: observed.room?.uniqueIdentifier.uuidString ?? "")
        do {
            try JSONEncoder().encode(receipt).write(to: output, options: .atomic)
            note = (["Apple 家庭读回", observed.name, observed.room?.name ?? ""] + failures).joined(separator: " · ")
        } catch { note = error.localizedDescription }
    }
}

@main struct BondHome: App {
    @StateObject private var bridge = Bridge()
    @State private var picking = false
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                Form {
                    Button("选择 NAS 上的 Bond 配件文件夹") { picking = true }
                    if let inventory = bridge.inventory {
                        Section(inventory.name) {
                            Text(inventory.identity).font(.caption)
                            Picker("Apple 家庭", selection: $bridge.homeID) {
                                Text("请选择").tag(nil as UUID?)
                                ForEach(bridge.homes, id: \.uniqueIdentifier) { Text($0.name).tag(Optional($0.uniqueIdentifier)) }
                            }
                            if let home = bridge.home {
                                Picker("配件", selection: $bridge.accessoryID) {
                                    Text("请选择").tag(nil as UUID?)
                                    ForEach(home.accessories, id: \.uniqueIdentifier) {
                                        Text($0.name + " · " + ($0.room?.name ?? "") + " · " + $0.uniqueIdentifier.uuidString.suffix(6)).tag(Optional($0.uniqueIdentifier))
                                    }
                                }
                                ForEach(inventory.rooms) { item in
                                    Picker(item.label, selection: Binding(get: { bridge.rooms[item.key] },
                                                set: { bridge.rooms[item.key] = $0 })) {
                                        Text("未绑定").tag(nil as UUID?)
                                        ForEach(home.rooms, id: \.uniqueIdentifier) { Text($0.name).tag(Optional($0.uniqueIdentifier)) }
                                    }
                                }
                                Button("确认绑定并接收同步") { bridge.bind() }
                            }
                        }
                    }
                    if !bridge.note.isEmpty { Text(bridge.note) }
                }.disabled(bridge.busy).navigationTitle("Bond 家庭同步")
                .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) {
                    do { bridge.open(try $0.get()) } catch { bridge.note = error.localizedDescription }
                }.task {
                    while !Task.isCancelled {
                        await bridge.process()
                        try? await Task.sleep(for: .seconds(2))
                    }
                }
            }
        }
    }
}
