FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

COPY raftline-api/target/raftline-api-1.0.0-SNAPSHOT.jar /app/raftline-server.jar

EXPOSE 8000 9000

ENV JAVA_OPTS="-Xms128m -Xmx512m -XX:+UseZGC"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/raftline-server.jar \"$@\"", "--"]
