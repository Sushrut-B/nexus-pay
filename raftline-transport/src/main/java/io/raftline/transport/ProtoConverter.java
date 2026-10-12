package io.raftline.transport;

import com.google.protobuf.ByteString;
import io.raftline.core.rpc.*;
import io.raftline.storage.model.Command;
import io.raftline.storage.model.CommandType;
import io.raftline.storage.model.LogEntry;
import io.raftline.transport.proto.*;

import java.util.ArrayList;
import java.util.List;

public final class ProtoConverter {

    private ProtoConverter() {}

    public static RequestVoteProto toProto(RequestVoteRequest req) {
        return RequestVoteProto.newBuilder()
                .setTerm(req.term())
                .setCandidateId(req.candidateId())
                .setLastLogIndex(req.lastLogIndex())
                .setLastLogTerm(req.lastLogTerm())
                .build();
    }

    public static RequestVoteRequest fromProto(RequestVoteProto proto) {
        return new RequestVoteRequest(
                proto.getTerm(),
                proto.getCandidateId(),
                proto.getLastLogIndex(),
                proto.getLastLogTerm()
        );
    }

    public static RequestVoteResponseProto toProto(RequestVoteResponse res) {
        return RequestVoteResponseProto.newBuilder()
                .setTerm(res.term())
                .setVoteGranted(res.voteGranted())
                .build();
    }

    public static RequestVoteResponse fromProto(RequestVoteResponseProto proto) {
        return new RequestVoteResponse(
                proto.getTerm(),
                proto.getVoteGranted()
        );
    }

    public static CommandProto toProto(Command cmd) {
        CommandProto.Builder b = CommandProto.newBuilder()
                .setType(cmd.getType().getCode())
                .setKey(cmd.getKey() != null ? cmd.getKey() : "")
                .setValue(cmd.getValue() != null ? ByteString.copyFrom(cmd.getValue()) : ByteString.EMPTY)
                .setClientId(cmd.getClientId() != null ? cmd.getClientId() : "")
                .setSequenceNumber(cmd.getSequenceNumber());
        return b.build();
    }

    public static Command fromProto(CommandProto proto) {
        CommandType type = CommandType.fromCode((byte) proto.getType());
        return new Command(
                type,
                proto.getKey(),
                proto.getValue().toByteArray(),
                proto.getClientId(),
                proto.getSequenceNumber()
        );
    }

    public static LogEntryProto toProto(LogEntry entry) {
        return LogEntryProto.newBuilder()
                .setIndex(entry.getIndex())
                .setTerm(entry.getTerm())
                .setCommand(toProto(entry.getCommand()))
                .build();
    }

    public static LogEntry fromProto(LogEntryProto proto) {
        Command cmd = fromProto(proto.getCommand());
        return new LogEntry(proto.getIndex(), proto.getTerm(), cmd);
    }

    public static AppendEntriesProto toProto(AppendEntriesRequest req) {
        AppendEntriesProto.Builder b = AppendEntriesProto.newBuilder()
                .setTerm(req.term())
                .setLeaderId(req.leaderId())
                .setPrevLogIndex(req.prevLogIndex())
                .setPrevLogTerm(req.prevLogTerm())
                .setLeaderCommit(req.leaderCommit());

        for (LogEntry entry : req.entries()) {
            b.addEntries(toProto(entry));
        }
        return b.build();
    }

    public static AppendEntriesRequest fromProto(AppendEntriesProto proto) {
        List<LogEntry> entries = new ArrayList<>(proto.getEntriesCount());
        for (LogEntryProto ep : proto.getEntriesList()) {
            entries.add(fromProto(ep));
        }
        return new AppendEntriesRequest(
                proto.getTerm(),
                proto.getLeaderId(),
                proto.getPrevLogIndex(),
                proto.getPrevLogTerm(),
                entries,
                proto.getLeaderCommit()
        );
    }

    public static AppendEntriesResponseProto toProto(AppendEntriesResponse res) {
        return AppendEntriesResponseProto.newBuilder()
                .setTerm(res.term())
                .setSuccess(res.success())
                .setMatchIndex(res.matchIndex())
                .build();
    }

    public static AppendEntriesResponse fromProto(AppendEntriesResponseProto proto) {
        return new AppendEntriesResponse(
                proto.getTerm(),
                proto.getSuccess(),
                proto.getMatchIndex()
        );
    }

    public static InstallSnapshotProto toProto(InstallSnapshotRequest req) {
        return InstallSnapshotProto.newBuilder()
                .setTerm(req.term())
                .setLeaderId(req.leaderId())
                .setLastIncludedIndex(req.lastIncludedIndex())
                .setLastIncludedTerm(req.lastIncludedTerm())
                .setData(ByteString.copyFrom(req.data()))
                .setDone(req.done())
                .build();
    }

    public static InstallSnapshotRequest fromProto(InstallSnapshotProto proto) {
        return new InstallSnapshotRequest(
                proto.getTerm(),
                proto.getLeaderId(),
                proto.getLastIncludedIndex(),
                proto.getLastIncludedTerm(),
                proto.getData().toByteArray(),
                proto.getDone()
        );
    }

    public static InstallSnapshotResponseProto toProto(InstallSnapshotResponse res) {
        return InstallSnapshotResponseProto.newBuilder()
                .setTerm(res.term())
                .build();
    }

    public static InstallSnapshotResponse fromProto(InstallSnapshotResponseProto proto) {
        return new InstallSnapshotResponse(proto.getTerm());
    }
}
